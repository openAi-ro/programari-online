-- v48: reducere la orele linistite (off-peak), aplicata pe server in toate
-- fluxurile de rezervare. Setarile stau pe business_profiles; 0/lipsa = oprit.
alter table public.business_profiles
  add column if not exists offpeak_discount_percent int not null default 0,
  add column if not exists offpeak_start_hour int,
  add column if not exists offpeak_end_hour int;

create or replace function public.offpeak_price(
  p_business_id uuid,
  p_start_at timestamptz,
  p_price numeric
) returns numeric
language plpgsql
stable
set search_path = public
as $$
declare
  v_pct int;
  v_sh int;
  v_eh int;
  v_tz text;
  v_hour int;
begin
  if p_price is null then
    return null;
  end if;
  select offpeak_discount_percent, offpeak_start_hour, offpeak_end_hour, timezone
    into v_pct, v_sh, v_eh, v_tz
    from public.business_profiles
    where id = p_business_id;
  if coalesce(v_pct, 0) <= 0 or v_sh is null or v_eh is null then
    return p_price;
  end if;
  v_hour := extract(hour from timezone(coalesce(v_tz, 'Europe/Bucharest'), p_start_at));
  if (v_sh <= v_eh and v_hour >= v_sh and v_hour < v_eh)
     or (v_sh > v_eh and (v_hour >= v_sh or v_hour < v_eh)) then
    return round(p_price * (100 - least(v_pct, 90)) / 100, 2);
  end if;
  return p_price;
end;
$$;

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

  v_svc_price := public.offpeak_price(p_business_id, p_start_at, v_svc_price);

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

create or replace function public.create_guest_appointment(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null,
  p_staff_id uuid default null,
  p_client_name text default null,
  p_client_phone text default null,
  p_client_email text default null
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_staff_id uuid;
  v_staff_name text;
  v_phone text;
  v_email text;
  v_name text;
  v_active int;
  v_row public.appointments;
begin
  v_phone := nullif(trim(coalesce(p_client_phone, '')), '');
  v_email := nullif(trim(coalesce(p_client_email, '')), '');
  v_name := nullif(trim(coalesce(p_client_name, '')), '');
  if v_phone is null and v_email is null then
    raise exception 'contact_required';
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

  -- anti-spam: acelasi contact, max 3 programari active viitoare la acest business
  select count(*) into v_active
  from public.appointments
  where business_id = p_business_id
    and status in ('pending', 'approved')
    and start_at > now()
    and (
      (v_phone is not null and client_phone = v_phone)
      or (v_email is not null and client_email = v_email)
    );
  if v_active >= 3 then
    raise exception 'too_many_guest';
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_biz.session_duration_minutes, 30);
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

  v_svc_price := public.offpeak_price(p_business_id, p_start_at, v_svc_price);

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
    client_email, client_phone, guest_name,
    service_id, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name,
    decision_notified, reminder_sent, reminder_24h_sent,
    attendance_confirmed, loyalty_redeemed, no_show
  ) values (
    p_business_id, null, p_start_at, v_end, 'pending',
    v_email, v_phone, v_name,
    v_svc_id, v_svc_name, v_duration, v_svc_price,
    'none', 0,
    v_staff_id, v_staff_name,
    false, false, false,
    false, false, false
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.create_recurring_appointments(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null,
  p_staff_id uuid default null,
  p_repeat_count int default 2
) returns setof public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_duration int;
  v_buffer int;
  v_status public.appointment_status;
  v_deposit numeric(10, 2);
  v_pay text;
  v_staff_id uuid;
  v_staff_name text;
  v_count int;
  v_i int;
  v_slot timestamptz;
  v_end timestamptz;
  v_local_date text;
  v_row public.appointments;
  v_series uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  v_count := greatest(2, least(coalesce(p_repeat_count, 2), 8));

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
  v_duration := coalesce(v_biz.session_duration_minutes, 30);
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
  end if;

  for v_i in 0..(v_count - 1) loop
    v_slot := timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), p_start_at) + make_interval(weeks => v_i));
    v_end := v_slot + make_interval(mins => v_duration);

    if v_i = 0 and v_slot < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
      raise exception 'too_soon';
    end if;

    if v_slot > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
      raise exception 'too_far';
    end if;

    v_local_date := to_char((timezone(v_biz.timezone, v_slot))::date, 'YYYY-MM-DD');
    if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
      raise exception 'day_blocked';
    end if;

    if exists (
      select 1 from public.appointments
      where business_id = p_business_id
        and staff_id is not distinct from v_staff_id
        and public.appointment_blocks_slot(status)
        and start_at < public.busy_end_with_buffer(v_end, v_buffer)
        and public.busy_end_with_buffer(end_at, v_buffer) > v_slot
    ) then
      raise exception 'slot_taken';
    end if;
  end loop;

  for v_i in 0..(v_count - 1) loop
    v_slot := timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), p_start_at) + make_interval(weeks => v_i));
    v_end := v_slot + make_interval(mins => v_duration);

    v_svc_price := public.offpeak_price(p_business_id, v_slot, v_svc_price);

    insert into public.appointments (
      business_id, client_user_id, start_at, end_at, status,
      client_email, client_phone,
      service_id, service_name, service_duration_minutes, service_price,
      payment_status, deposit_ron,
      staff_id, staff_name, loyalty_redeemed, recurring_series_id
    ) values (
      p_business_id, v_user, v_slot, v_end, v_status,
      v_email, v_phone,
      v_svc_id, v_svc_name, v_duration, v_svc_price,
      v_pay, v_deposit,
      v_staff_id, v_staff_name, false, v_series
    ) returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$$;

create or replace function public.create_appointment_multi_if_free(
  p_business_id uuid,
  p_start_at timestamptz,
  p_service_ids uuid[],
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
  v_found int;
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

  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    raise exception 'service_not_found';
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

  select count(*),
         string_agg(s.name, ' + ' order by u.ord),
         sum(s.duration_minutes)::int,
         sum(s.price)
    into v_found, v_svc_name, v_svc_duration, v_svc_price
    from unnest(p_service_ids) with ordinality as u(sid, ord)
    join public.services s
      on s.id = u.sid
     and s.business_id = p_business_id
     and s.active = true;
  if v_found <> cardinality(p_service_ids) then
    raise exception 'service_not_found';
  end if;
  v_svc_id := p_service_ids[1];
  v_duration := v_svc_duration;
  v_end := p_start_at + make_interval(mins => v_duration);

  v_svc_price := public.offpeak_price(p_business_id, p_start_at, v_svc_price);

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
    service_id, service_ids, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name, loyalty_redeemed
  ) values (
    p_business_id, v_user, p_start_at, v_end, v_status,
    v_email, v_phone,
    v_svc_id, p_service_ids, v_svc_name, v_svc_duration, v_svc_price,
    v_pay, v_deposit,
    v_staff_id, v_staff_name, v_loyalty
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.create_recurring_multi_appointments(
  p_business_id uuid,
  p_start_at timestamptz,
  p_service_ids uuid[],
  p_staff_id uuid default null,
  p_repeat_count int default 2
) returns setof public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_found int;
  v_duration int;
  v_buffer int;
  v_status public.appointment_status;
  v_deposit numeric(10, 2);
  v_pay text;
  v_staff_id uuid;
  v_staff_name text;
  v_count int;
  v_i int;
  v_slot timestamptz;
  v_end timestamptz;
  v_local_date text;
  v_row public.appointments;
  v_series uuid := gen_random_uuid();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    raise exception 'service_not_found';
  end if;

  v_count := greatest(2, least(coalesce(p_repeat_count, 2), 8));

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

  select count(*),
         string_agg(s.name, ' + ' order by u.ord),
         sum(s.duration_minutes)::int,
         sum(s.price)
    into v_found, v_svc_name, v_svc_duration, v_svc_price
    from unnest(p_service_ids) with ordinality as u(sid, ord)
    join public.services s
      on s.id = u.sid
     and s.business_id = p_business_id
     and s.active = true;
  if v_found <> cardinality(p_service_ids) then
    raise exception 'service_not_found';
  end if;
  v_svc_id := p_service_ids[1];
  v_duration := v_svc_duration;

  for v_i in 0..(v_count - 1) loop
    v_slot := timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), p_start_at) + make_interval(weeks => v_i));
    v_end := v_slot + make_interval(mins => v_duration);

    if v_i = 0 and v_slot < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
      raise exception 'too_soon';
    end if;

    if v_slot > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
      raise exception 'too_far';
    end if;

    v_local_date := to_char((timezone(v_biz.timezone, v_slot))::date, 'YYYY-MM-DD');
    if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
      raise exception 'day_blocked';
    end if;

    if exists (
      select 1 from public.appointments
      where business_id = p_business_id
        and staff_id is not distinct from v_staff_id
        and public.appointment_blocks_slot(status)
        and start_at < public.busy_end_with_buffer(v_end, v_buffer)
        and public.busy_end_with_buffer(end_at, v_buffer) > v_slot
    ) then
      raise exception 'slot_taken';
    end if;
  end loop;

  for v_i in 0..(v_count - 1) loop
    v_slot := timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), p_start_at) + make_interval(weeks => v_i));
    v_end := v_slot + make_interval(mins => v_duration);

    v_svc_price := public.offpeak_price(p_business_id, v_slot, v_svc_price);

    insert into public.appointments (
      business_id, client_user_id, start_at, end_at, status,
      client_email, client_phone,
      service_id, service_ids, service_name, service_duration_minutes, service_price,
      payment_status, deposit_ron,
      staff_id, staff_name, loyalty_redeemed, recurring_series_id
    ) values (
      p_business_id, v_user, v_slot, v_end, v_status,
      v_email, v_phone,
      v_svc_id, p_service_ids, v_svc_name, v_duration, v_svc_price,
      v_pay, v_deposit,
      v_staff_id, v_staff_name, false, v_series
    ) returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$$;

notify pgrst, 'reload schema';
