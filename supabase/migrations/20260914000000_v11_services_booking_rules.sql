-- v1.1: catalog servicii, reguli de booking, reprogramare, reminder 24h, confirmare prezență

-- ---------------------------------------------------------------------------
-- business_profiles: reguli
-- ---------------------------------------------------------------------------
alter table public.business_profiles
  add column if not exists min_notice_minutes int not null default 120
    check (min_notice_minutes between 0 and 10080),
  add column if not exists buffer_minutes int not null default 0
    check (buffer_minutes between 0 and 240),
  add column if not exists max_advance_days int not null default 90
    check (max_advance_days between 1 and 365),
  add column if not exists cancel_notice_minutes int not null default 120
    check (cancel_notice_minutes between 0 and 10080),
  add column if not exists blocked_dates jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- services
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  name text not null,
  duration_minutes int not null check (duration_minutes between 5 and 480),
  price numeric(10, 2) not null default 0 check (price >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists services_business_idx on public.services(business_id, active, sort_order);

alter table public.services enable row level security;

drop policy if exists services_select_authenticated on public.services;
create policy services_select_authenticated on public.services
  for select to authenticated using (
    active = true
    or auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

drop policy if exists services_write_owner on public.services;
create policy services_write_owner on public.services
  for all to authenticated
  using (
    auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  )
  with check (
    auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

grant select, insert, update, delete on public.services to authenticated;

-- Default service for existing businesses (one "Ședință" from session duration)
insert into public.services (business_id, name, duration_minutes, price, sort_order)
select b.id, 'Ședință', b.session_duration_minutes, 0, 0
from public.business_profiles b
where not exists (
  select 1 from public.services s where s.business_id = b.id
);

-- ---------------------------------------------------------------------------
-- appointments: snapshot serviciu + reminder 24h + prezență
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column if not exists service_id uuid references public.services(id) on delete set null,
  add column if not exists service_name text,
  add column if not exists service_duration_minutes int,
  add column if not exists service_price numeric(10, 2),
  add column if not exists reminder_24h_sent boolean not null default false,
  add column if not exists attendance_confirmed boolean not null default false;

create index if not exists appointments_reminder_24h_idx
  on public.appointments(status, reminder_24h_sent, start_at);

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------
create or replace function public.busy_end_with_buffer(
  p_end_at timestamptz,
  p_buffer_minutes int
) returns timestamptz
language sql
immutable
as $$
  select p_end_at + make_interval(mins => greatest(coalesce(p_buffer_minutes, 0), 0));
$$;

grant execute on function public.busy_end_with_buffer(timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- create_appointment_if_free (drop 3-arg to avoid PostgREST overload)
-- ---------------------------------------------------------------------------
drop function if exists public.create_appointment_if_free(uuid, timestamptz, timestamptz);

create or replace function public.create_appointment_if_free(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null
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
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := v_biz.session_duration_minutes;
  v_end := p_end_at;

  if p_service_id is not null then
    select id, name, duration_minutes, price
    into v_svc_id, v_svc_name, v_svc_duration, v_svc_price
    from public.services
    where id = p_service_id
      and business_id = p_business_id
      and active = true;
    if not found then
      raise exception 'service_not_found';
    end if;
    v_duration := v_svc_duration;
    v_end := p_start_at + make_interval(mins => v_duration);
  end if;

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
    raise exception 'too_soon';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform 1 from public.appointments
  where business_id = p_business_id
    and public.appointment_blocks_slot(status)
    and start_at < public.busy_end_with_buffer(v_end, v_buffer)
    and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = p_business_id
      and public.appointment_blocks_slot(status)
      and start_at < public.busy_end_with_buffer(v_end, v_buffer)
      and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status,
    client_email, client_phone,
    service_id, service_name, service_duration_minutes, service_price
  ) values (
    p_business_id, v_user, p_start_at, v_end, 'pending',
    v_email, v_phone,
    v_svc_id, v_svc_name, v_svc_duration, v_svc_price
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_appointment — pending oricare înainte de start; approved respectă preaviz
-- ---------------------------------------------------------------------------
create or replace function public.cancel_appointment(
  p_appointment_id uuid
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_notice int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row
  from public.appointments a
  where a.id = p_appointment_id
    and a.client_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_owner';
  end if;

  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_cancel';
  end if;

  if v_row.start_at <= now() then
    raise exception 'cannot_cancel';
  end if;

  if v_row.status = 'approved' then
    select cancel_notice_minutes into v_notice
    from public.business_profiles
    where id = v_row.business_id;
    if v_row.start_at < now() + make_interval(mins => coalesce(v_notice, 0)) then
      raise exception 'too_late';
    end if;
  end if;

  update public.appointments
  set status = 'cancelled',
      updated_at = now()
  where id = p_appointment_id
    and status in ('pending', 'approved')
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_cancel';
  end if;

  return v_row;
end;
$$;

grant execute on function public.cancel_appointment(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_appointment
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_notice int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
  from public.appointments
  where id = p_appointment_id
    and client_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_owner';
  end if;

  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_reschedule';
  end if;

  if v_row.start_at <= now() then
    raise exception 'cannot_reschedule';
  end if;

  select * into v_biz from public.business_profiles where id = v_row.business_id;

  v_notice := coalesce(v_biz.cancel_notice_minutes, 0);
  if v_row.status = 'approved' and v_row.start_at < now() + make_interval(mins => v_notice) then
    raise exception 'too_late';
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_row.service_duration_minutes, v_biz.session_duration_minutes);
  v_end := p_start_at + make_interval(mins => v_duration);
  if p_end_at > p_start_at then
    -- client may send matching end; duration snapshot remains source of truth
    v_end := p_start_at + make_interval(mins => v_duration);
  end if;

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
    raise exception 'too_soon';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform 1 from public.appointments
  where business_id = v_row.business_id
    and id <> p_appointment_id
    and public.appointment_blocks_slot(status)
    and start_at < public.busy_end_with_buffer(v_end, v_buffer)
    and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = v_row.business_id
      and id <> p_appointment_id
      and public.appointment_blocks_slot(status)
      and start_at < public.busy_end_with_buffer(v_end, v_buffer)
      and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  update public.appointments
  set start_at = p_start_at,
      end_at = v_end,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      updated_at = now()
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_attendance
-- ---------------------------------------------------------------------------
create or replace function public.confirm_attendance(
  p_appointment_id uuid
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  update public.appointments
  set attendance_confirmed = true,
      updated_at = now()
  where id = p_appointment_id
    and client_user_id = v_user
    and status = 'approved'
    and start_at > now()
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_confirm';
  end if;

  return v_row;
end;
$$;

revoke all on function public.confirm_attendance(uuid) from public;
grant execute on function public.confirm_attendance(uuid) to authenticated;
