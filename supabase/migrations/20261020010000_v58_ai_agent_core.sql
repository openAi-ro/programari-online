-- v58: ai agent core — private per-business AI settings, structured agent journal,
-- and a call limiter. Idempotent (safe to re-run).
--
-- Design: all AI configuration lives in business_ai_settings (single source of
-- truth, owner-only). business_profiles is anon-readable, so nothing AI-related
-- is added there. No row = agent OFF (opt-in per business).
-- The agent core (Edge Function ai-agent) returns structured facts and proposed
-- tools only. It never writes bookings and never stores message bodies.

-- 1) Private settings (owner reads/writes own row; anon nothing; service_role all).
create table if not exists public.business_ai_settings (
  business_id uuid primary key references public.business_profiles(id) on delete cascade,
  agent_enabled boolean not null default false,
  custom_faq text not null default '' check (char_length(custom_faq) <= 4000),
  updated_at timestamptz not null default now()
);

alter table public.business_ai_settings enable row level security;

revoke all on public.business_ai_settings from public, anon, authenticated;
grant select, insert, update on public.business_ai_settings to authenticated;
grant all on public.business_ai_settings to service_role;

drop policy if exists business_ai_settings_owner_select on public.business_ai_settings;
create policy business_ai_settings_owner_select
  on public.business_ai_settings for select to authenticated
  using (exists (
    select 1 from public.business_profiles b
    where b.id = business_ai_settings.business_id and b.owner_user_id = (select auth.uid())
  ));

drop policy if exists business_ai_settings_owner_insert on public.business_ai_settings;
create policy business_ai_settings_owner_insert
  on public.business_ai_settings for insert to authenticated
  with check (exists (
    select 1 from public.business_profiles b
    where b.id = business_ai_settings.business_id and b.owner_user_id = (select auth.uid())
  ));

drop policy if exists business_ai_settings_owner_update on public.business_ai_settings;
create policy business_ai_settings_owner_update
  on public.business_ai_settings for update to authenticated
  using (exists (
    select 1 from public.business_profiles b
    where b.id = business_ai_settings.business_id and b.owner_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.business_profiles b
    where b.id = business_ai_settings.business_id and b.owner_user_id = (select auth.uid())
  ));

create or replace function public.business_ai_settings_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists business_ai_settings_touch on public.business_ai_settings;
create trigger business_ai_settings_touch
  before update on public.business_ai_settings
  for each row execute function public.business_ai_settings_touch();

-- 2) Structured journal (no message bodies). Service role writes; owner reads own rows.
create table if not exists public.ai_agent_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  channel text not null check (channel in ('app', 'whatsapp', 'internal')),
  intent text not null,
  confidence numeric(4, 3) not null default 0,
  source text not null default 'rules' check (source in ('rules', 'llm', 'none')),
  tools_proposed jsonb not null default '[]'::jsonb,
  handoff boolean not null default false
);

create index if not exists ai_agent_log_business_created_idx
  on public.ai_agent_log (business_id, created_at desc);

alter table public.ai_agent_log enable row level security;

revoke all on public.ai_agent_log from public, anon, authenticated;
grant select on public.ai_agent_log to authenticated;
grant all on public.ai_agent_log to service_role;

drop policy if exists ai_agent_log_owner_read on public.ai_agent_log;
create policy ai_agent_log_owner_read
  on public.ai_agent_log for select to authenticated
  using (exists (
    select 1 from public.business_profiles b
    where b.id = ai_agent_log.business_id and b.owner_user_id = (select auth.uid())
  ));

-- 3) Call limiter: fixed-window counters, service_role only.
-- Defaults: per caller 20/minute and 200/day; per business 1000/day (UTC days).
-- Order: caller minute -> caller day -> business day, so a blocked caller does not
-- use up the business quota.
create table if not exists public.ai_agent_rate (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);

alter table public.ai_agent_rate enable row level security;
revoke all on public.ai_agent_rate from public, anon, authenticated;
grant all on public.ai_agent_rate to service_role;

create or replace function public.ai_agent_check_rate(
  p_business_id uuid,
  p_caller_key text,
  p_caller_per_minute integer default 20,
  p_caller_per_day integer default 200,
  p_business_per_day integer default 1000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day timestamptz := date_trunc('day', v_now at time zone 'UTC') at time zone 'UTC';
  v_hits integer;
begin
  if p_business_id is null then
    raise exception 'business_required';
  end if;

  -- Opportunistic cleanup of old windows (about 1% of calls).
  if random() < 0.01 then
    delete from public.ai_agent_rate where window_start < v_now - interval '2 days';
  end if;

  if coalesce(p_caller_key, '') <> '' then
    insert into public.ai_agent_rate as r (bucket, window_start, hits)
    values ('c:' || p_caller_key || ':m', v_minute, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;
    if v_hits > p_caller_per_minute then
      return jsonb_build_object('allowed', false, 'scope', 'caller_minute',
        'retry_after_s', ceil(extract(epoch from (v_minute + interval '1 minute' - v_now)))::int);
    end if;

    insert into public.ai_agent_rate as r (bucket, window_start, hits)
    values ('c:' || p_caller_key || ':d', v_day, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning hits into v_hits;
    if v_hits > p_caller_per_day then
      return jsonb_build_object('allowed', false, 'scope', 'caller_day',
        'retry_after_s', ceil(extract(epoch from (v_day + interval '1 day' - v_now)))::int);
    end if;
  end if;


  insert into public.ai_agent_rate as r (bucket, window_start, hits)
  values ('b:' || p_business_id::text || ':d', v_day, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  if v_hits > p_business_per_day then
    return jsonb_build_object('allowed', false, 'scope', 'business_day',
      'retry_after_s', ceil(extract(epoch from (v_day + interval '1 day' - v_now)))::int);
  end if;

  return jsonb_build_object('allowed', true, 'scope', null, 'retry_after_s', 0);
end;
$$;

revoke all on function public.ai_agent_check_rate(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_agent_check_rate(uuid, text, integer, integer, integer)
  to service_role;

comment on table public.business_ai_settings is
  'Private AI agent settings per business (switch + FAQ). Owner-only; no row = agent off.';
comment on table public.ai_agent_log is
  'Structured agent decisions (no message bodies). Service role writes; business owner reads own rows.';
comment on table public.ai_agent_rate is
  'Fixed-window call counters for ai-agent. Service role only.';
comment on function public.ai_agent_check_rate(uuid, text, integer, integer, integer) is
  'Counts one ai-agent call and says whether it is allowed (per caller per minute/day, per business per day).';

notify pgrst, 'reload schema';
