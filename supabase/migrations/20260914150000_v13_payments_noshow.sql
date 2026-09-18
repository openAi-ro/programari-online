-- v1.3: avans (Stripe/manual), no-show, blocare clienți, auto-aprobare recurenți

-- ---------------------------------------------------------------------------
-- Business rules
-- ---------------------------------------------------------------------------
alter table public.business_profiles
  add column if not exists deposit_ron numeric(10, 2) not null default 0
    check (deposit_ron >= 0 and deposit_ron <= 10000),
  add column if not exists auto_approve_returning boolean not null default false,
  add column if not exists no_show_block_after int not null default 2
    check (no_show_block_after between 0 and 20);

-- ---------------------------------------------------------------------------
-- Appointments: payment + no-show
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column if not exists payment_status text not null default 'none'
    check (payment_status in ('none', 'unpaid', 'paid', 'refunded', 'waived')),
  add column if not exists deposit_ron numeric(10, 2) not null default 0
    check (deposit_ron >= 0),
  add column if not exists no_show boolean not null default false;

create index if not exists appointments_payment_idx
  on public.appointments (business_id, payment_status);

-- ---------------------------------------------------------------------------
-- Payments (audit)
-- ---------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  amount_ron numeric(10, 2) not null check (amount_ron > 0),
  currency text not null default 'RON',
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  provider text not null default 'manual'
    check (provider in ('stripe', 'manual')),
  provider_ref text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists payments_appointment_idx on public.payments (appointment_id, created_at desc);

alter table public.payments enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated using (
    auth.uid() = client_user_id
    or auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

grant select on public.payments to authenticated;

-- ---------------------------------------------------------------------------
-- Client blocks
-- ---------------------------------------------------------------------------
create table if not exists public.client_blocks (
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null default '',
  created_at timestamptz not null default now(),
  primary key (business_id, client_user_id)
);

alter table public.client_blocks enable row level security;

drop policy if exists client_blocks_owner on public.client_blocks;
create policy client_blocks_owner on public.client_blocks
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

grant select, insert, update, delete on public.client_blocks to authenticated;

-- ---------------------------------------------------------------------------
-- create_appointment_if_free: blocked, deposit, auto-approve
-- ---------------------------------------------------------------------------
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
  v_status text;
  v_deposit numeric(10, 2);
  v_pay text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if exists (
    select 1 from public.client_blocks
    where business_id = p_business_id and client_user_id = v_user
  ) then
    raise exception 'client_blocked';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := v_biz.session_duration_minutes;
  v_end := p_end_at;
  v_deposit := coalesce(v_biz.deposit_ron, 0);
  v_pay := case when v_deposit > 0 then 'unpaid' else 'none' end;
  v_status := 'pending';

  if coalesce(v_biz.auto_approve_returning, false)
     and exists (
       select 1 from public.appointments
       where business_id = p_business_id
         and client_user_id = v_user
         and status = 'approved'
     )
  then
    v_status := 'approved';
  end if;

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
    service_id, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron
  ) values (
    p_business_id, v_user, p_start_at, v_end, v_status,
    v_email, v_phone,
    v_svc_id, v_svc_name, v_svc_duration, v_svc_price,
    v_pay, v_deposit
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- join_waitlist: refuse blocked clients
-- ---------------------------------------------------------------------------
create or replace function public.join_waitlist(
  p_business_id uuid,
  p_desired_date date,
  p_service_id uuid default null
) returns public.waitlist
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_row public.waitlist;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if exists (
    select 1 from public.client_blocks
    where business_id = p_business_id and client_user_id = v_user
  ) then
    raise exception 'client_blocked';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if not exists (select 1 from public.business_profiles where id = p_business_id) then
    raise exception 'business_not_found';
  end if;

  select * into v_row
  from public.waitlist
  where business_id = p_business_id
    and client_user_id = v_user
    and desired_date = p_desired_date
    and status = 'active'
    and coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_service_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if found then
    return v_row;
  end if;

  insert into public.waitlist (
    business_id, client_user_id, service_id, desired_date, status, client_email, client_phone
  )
  values (p_business_id, v_user, p_service_id, p_desired_date, 'active', v_email, v_phone)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.join_waitlist(uuid, date, uuid) from public;
grant execute on function public.join_waitlist(uuid, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_attendance: cannot confirm a no-show
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
    and coalesce(no_show, false) = false
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_confirm';
  end if;

  return v_row;
end;
$$;

revoke all on function public.confirm_attendance(uuid) from public;
grant execute on function public.confirm_attendance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_no_show / clear_no_show (business owner)
-- ---------------------------------------------------------------------------
create or replace function public.mark_no_show(
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

  update public.appointments a
  set no_show = true,
      attendance_confirmed = false,
      updated_at = now()
  where a.id = p_appointment_id
    and a.status = 'approved'
    and a.start_at <= now()
    and a.no_show = false
    and v_user in (
      select owner_user_id from public.business_profiles b where b.id = a.business_id
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_mark_noshow';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_no_show(uuid) from public;
grant execute on function public.mark_no_show(uuid) to authenticated;

create or replace function public.clear_no_show(
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

  update public.appointments a
  set no_show = false,
      updated_at = now()
  where a.id = p_appointment_id
    and a.no_show = true
    and v_user in (
      select owner_user_id from public.business_profiles b where b.id = a.business_id
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_clear_noshow';
  end if;

  return v_row;
end;
$$;

revoke all on function public.clear_no_show(uuid) from public;
grant execute on function public.clear_no_show(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- mark_deposit_paid / waive (owner, cash/transfer)
-- ---------------------------------------------------------------------------
create or replace function public.mark_deposit_paid(
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

  update public.appointments a
  set payment_status = 'paid',
      updated_at = now()
  where a.id = p_appointment_id
    and a.payment_status = 'unpaid'
    and a.deposit_ron > 0
    and v_user in (
      select owner_user_id from public.business_profiles b where b.id = a.business_id
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_mark_paid';
  end if;

  insert into public.payments (
    business_id, appointment_id, client_user_id, amount_ron, status, provider, paid_at
  ) values (
    v_row.business_id, v_row.id, v_row.client_user_id, v_row.deposit_ron, 'paid', 'manual', now()
  );

  return v_row;
end;
$$;

revoke all on function public.mark_deposit_paid(uuid) from public;
grant execute on function public.mark_deposit_paid(uuid) to authenticated;

create or replace function public.waive_deposit(
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

  update public.appointments a
  set payment_status = 'waived',
      updated_at = now()
  where a.id = p_appointment_id
    and a.payment_status = 'unpaid'
    and v_user in (
      select owner_user_id from public.business_profiles b where b.id = a.business_id
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_waive';
  end if;

  return v_row;
end;
$$;

revoke all on function public.waive_deposit(uuid) from public;
grant execute on function public.waive_deposit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- block / unblock client
-- ---------------------------------------------------------------------------
create or replace function public.block_client(
  p_business_id uuid,
  p_client_user_id uuid,
  p_reason text default ''
) returns public.client_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.client_blocks;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if not exists (
    select 1 from public.business_profiles
    where id = p_business_id and owner_user_id = v_user
  ) then
    raise exception 'not_owner';
  end if;

  insert into public.client_blocks (business_id, client_user_id, reason)
  values (p_business_id, p_client_user_id, coalesce(p_reason, ''))
  on conflict (business_id, client_user_id) do update
    set reason = excluded.reason
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.block_client(uuid, uuid, text) from public;
grant execute on function public.block_client(uuid, uuid, text) to authenticated;

create or replace function public.unblock_client(
  p_business_id uuid,
  p_client_user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  delete from public.client_blocks bl
  where bl.business_id = p_business_id
    and bl.client_user_id = p_client_user_id
    and v_user in (
      select owner_user_id from public.business_profiles b where b.id = bl.business_id
    );

  if not found then
    raise exception 'cannot_unblock';
  end if;
end;
$$;

revoke all on function public.unblock_client(uuid, uuid) from public;
grant execute on function public.unblock_client(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Client list: no-show count + blocked
-- ---------------------------------------------------------------------------
drop function if exists public.list_business_clients();

create or replace function public.list_business_clients()
returns table (
  business_id uuid,
  client_user_id uuid,
  contact text,
  display_name text,
  visit_count bigint,
  last_start_at timestamptz,
  upcoming_count bigint,
  note text,
  no_show_count bigint,
  blocked boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.business_id,
    a.client_user_id,
    coalesce(
      nullif(max(a.client_phone), ''),
      nullif(max(a.client_email), ''),
      'fără contact'
    ) as contact,
    max(p.display_name) as display_name,
    count(*) filter (where a.status = 'approved') as visit_count,
    max(a.start_at) filter (
      where a.status = 'approved' and a.start_at < now()
    ) as last_start_at,
    count(*) filter (
      where a.status in ('pending', 'approved') and a.start_at >= now()
    ) as upcoming_count,
    coalesce(max(n.note), '') as note,
    count(*) filter (where a.no_show) as no_show_count,
    (max(bl.created_at) is not null) as blocked
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  left join public.profiles p on p.id = a.client_user_id
  left join public.client_notes n
    on n.business_id = a.business_id and n.client_user_id = a.client_user_id
  left join public.client_blocks bl
    on bl.business_id = a.business_id and bl.client_user_id = a.client_user_id
  where b.owner_user_id = auth.uid()
  group by a.business_id, a.client_user_id
  order by max(a.start_at) desc;
$$;

revoke all on function public.list_business_clients() from public;
grant execute on function public.list_business_clients() to authenticated;
