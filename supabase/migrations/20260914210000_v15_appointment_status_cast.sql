-- v15: create_appointment_if_free wrote text into appointment_status enum → every insert failed (42804).

create or replace function public.create_appointment_if_free(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null,
  p_staff_id uuid default null
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
  v_status public.appointment_status;
  v_deposit numeric(10, 2);
  v_pay text;
  v_staff_id uuid;
  v_staff_name text;
  v_visits bigint;
  v_loyalty boolean := false;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.profiles (id, email, phone)
  select
    v_user,
    nullif(u.email, ''),
    nullif(u.phone, '')
  from auth.users u
  where u.id = v_user
  on conflict (id) do update
    set email = coalesce(nullif(public.profiles.email, ''), excluded.email),
        phone = coalesce(nullif(public.profiles.phone, ''), excluded.phone);

  select nullif(trim(email), ''), nullif(trim(phone), '')
    into v_email, v_phone
    from public.profiles
    where id = v_user;
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

  if p_staff_id is not null then
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where id = p_staff_id and business_id = p_business_id and active = true;
    if not found then
      raise exception 'staff_not_found';
    end if;
  else
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
    order by sort_order, created_at
    limit 1;
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

  select count(*) into v_visits
  from public.appointments
  where business_id = p_business_id
    and client_user_id = v_user
    and status = 'approved'
    and coalesce(no_show, false) = false;

  if coalesce(v_biz.loyalty_every, 0) >= 2
     and ((v_visits + 1) % v_biz.loyalty_every) = 0 then
    v_loyalty := true;
    v_svc_price := 0;
    v_deposit := 0;
    v_pay := 'none';
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
    and staff_id is not distinct from v_staff_id
    and public.appointment_blocks_slot(status)
    and start_at < public.busy_end_with_buffer(v_end, v_buffer)
    and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = p_business_id
      and staff_id is not distinct from v_staff_id
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
    payment_status, deposit_ron,
    staff_id, staff_name, loyalty_redeemed
  ) values (
    p_business_id, v_user, p_start_at, v_end, v_status,
    v_email, v_phone,
    v_svc_id, v_svc_name, v_svc_duration, v_svc_price,
    v_pay, v_deposit,
    v_staff_id, v_staff_name, v_loyalty
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'appointments'
  ) then
    execute 'alter publication supabase_realtime add table public.appointments';
  end if;
exception
  when undefined_object then
    null;
end;
$$;

notify pgrst, 'reload schema';
