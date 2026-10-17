-- v44: sincronizare Google Calendar (doar Google, ales de proprietar)
-- Evenimentele personale blocheaza sloturi; programarile pleaca spre Google.
-- Refresh token-ul e accesibil DOAR functiilor server (service role), niciodata clientului.

create table if not exists public.google_calendar_connections (
  business_id uuid primary key references public.business_profiles(id) on delete cascade,
  google_calendar_id text not null default 'primary',
  refresh_token text not null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table if not exists public.google_busy_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  google_event_id text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (business_id, google_event_id)
);

create index if not exists google_busy_blocks_range_idx
  on public.google_busy_blocks (business_id, start_at, end_at);

alter table public.appointments
  add column if not exists google_event_id text;

alter table public.google_calendar_connections enable row level security;
alter table public.google_busy_blocks enable row level security;
-- Fara politici pentru anon/authenticated: doar service role (Edge) atinge tabelele.

-- Sloturile ocupate includ si evenimentele personale din Google Calendar.
create or replace function public.list_busy_ranges(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff_id uuid default null
) returns table (start_at timestamptz, end_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select a.start_at, a.end_at
  from public.appointments a
  where a.business_id = p_business_id
    and public.appointment_blocks_slot(a.status)
    and a.start_at < p_to
    and a.end_at > p_from
    and (p_staff_id is null or a.staff_id = p_staff_id)
  union all
  select g.start_at, g.end_at
  from public.google_busy_blocks g
  where g.business_id = p_business_id
    and g.start_at < p_to
    and g.end_at > p_from;
$$;

revoke all on function public.list_busy_ranges(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.list_busy_ranges(uuid, timestamptz, timestamptz, uuid) to anon, authenticated;

-- Starea conexiunii, fara token: doar proprietarul firmei.
create or replace function public.get_google_calendar_status(p_business_id uuid)
returns table (google_calendar_id text, connected_at timestamptz, last_synced_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.business_profiles b
    where b.id = p_business_id and b.owner_user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;
  return query
  select c.google_calendar_id, c.connected_at, c.last_synced_at
  from public.google_calendar_connections c
  where c.business_id = p_business_id;
end;
$$;

revoke all on function public.get_google_calendar_status(uuid) from public;
grant execute on function public.get_google_calendar_status(uuid) to authenticated;

-- Deconectare: sterge conexiunea si blocarile importate.
create or replace function public.disconnect_google_calendar(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.business_profiles b
    where b.id = p_business_id and b.owner_user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;
  delete from public.google_busy_blocks where business_id = p_business_id;
  delete from public.google_calendar_connections where business_id = p_business_id;
  update public.appointments set google_event_id = null where business_id = p_business_id;
end;
$$;

revoke all on function public.disconnect_google_calendar(uuid) from public;
grant execute on function public.disconnect_google_calendar(uuid) to authenticated;

notify pgrst, 'reload schema';
