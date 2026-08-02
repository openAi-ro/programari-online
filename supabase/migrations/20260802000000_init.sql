-- profiles (1:1 auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  display_name text,
  created_at timestamptz not null default now(),
  constraint profiles_contact_chk check (email is not null or phone is not null)
);

create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  public_code text not null unique,
  timezone text not null default 'Europe/Bucharest',
  session_duration_minutes int not null check (session_duration_minutes between 5 and 480),
  working_hours jsonb not null,
  break_hours jsonb not null default '{"enabled":false,"start":"13:00","end":"14:00"}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_profiles_owner_idx on public.business_profiles(owner_user_id);
create index business_profiles_public_code_idx on public.business_profiles(public_code);

create type public.appointment_status as enum ('pending','approved','rejected','cancelled');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.appointment_status not null default 'pending',
  client_email text,
  client_phone text,
  reminder_sent boolean not null default false,
  decision_notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_contact_chk check (client_email is not null or client_phone is not null),
  constraint appointments_range_chk check (end_at > start_at)
);

create index appointments_business_time_idx on public.appointments(business_id, start_at, end_at);
create index appointments_client_idx on public.appointments(client_user_id);
create index appointments_reminder_idx on public.appointments(status, reminder_sent, start_at);

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios','android')),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

-- overlap helper: active statuses that block a slot
create or replace function public.appointment_blocks_slot(s public.appointment_status)
returns boolean language sql immutable as $$
  select s in ('pending','approved');
$$;

-- atomic create if free + contact present
create or replace function public.create_appointment_if_free(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid_range';
  end if;

  -- lock competing rows for this business in range
  perform 1 from public.appointments
  where business_id = p_business_id
    and public.appointment_blocks_slot(status)
    and start_at < p_end_at
    and end_at > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = p_business_id
      and public.appointment_blocks_slot(status)
      and start_at < p_end_at
      and end_at > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status, client_email, client_phone
  ) values (
    p_business_id, v_user, p_start_at, p_end_at, 'pending', v_email, v_phone
  ) returning * into v_row;

  return v_row;
end;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.business_profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.device_push_tokens enable row level security;

create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);

create policy business_select_authenticated on public.business_profiles
  for select to authenticated using (true);
create policy business_insert_owner on public.business_profiles
  for insert with check (auth.uid() = owner_user_id);
create policy business_update_owner on public.business_profiles
  for update using (auth.uid() = owner_user_id);

create policy appointments_select_participant on public.appointments for select using (
  auth.uid() = client_user_id
  or auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id)
);
create policy appointments_update_owner on public.appointments for update using (
  auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id)
);
-- inserts only via RPC create_appointment_if_free (security definer)

create policy push_tokens_own on public.device_push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trigger: new user -> profile (email/phone from auth)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone, display_name)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'display_name', null)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
