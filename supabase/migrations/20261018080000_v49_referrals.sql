-- v49: program de recomandare — clientul invita prieteni cu codul lui;
-- recompensa se acorda automat la prima vizita aprobata a invitatului.
alter table public.profiles
  add column if not exists referral_code text unique;

alter table public.business_profiles
  add column if not exists referral_enabled boolean not null default false,
  add column if not exists referral_reward_text text;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null,
  referred_user_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  check (referrer_user_id <> referred_user_id)
);

create index if not exists referrals_referrer_idx on public.referrals (referrer_user_id);

alter table public.referrals enable row level security;

drop policy if exists referrals_owner_select on public.referrals;
create policy referrals_owner_select on public.referrals
  for select to authenticated
  using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

grant select on public.referrals to authenticated;

-- Inregistreaza codul de recomandare primit la inscriere.
create or replace function public.record_referral(p_code text)
returns public.referrals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_referrer uuid;
  v_row public.referrals;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
  if v_code = '' then
    raise exception 'invalid_code';
  end if;

  select id into v_referrer
  from public.profiles
  where referral_code = v_code;
  if not found then
    raise exception 'code_not_found';
  end if;
  if v_referrer = v_user then
    raise exception 'self_referral';
  end if;

  insert into public.referrals (referrer_user_id, referred_user_id)
  values (v_referrer, v_user)
  on conflict (referred_user_id) do nothing
  returning * into v_row;

  if not found then
    select * into v_row from public.referrals where referred_user_id = v_user;
  end if;
  return v_row;
end;
$$;

revoke all on function public.record_referral(text) from public;
grant execute on function public.record_referral(text) to authenticated;

notify pgrst, 'reload schema';
