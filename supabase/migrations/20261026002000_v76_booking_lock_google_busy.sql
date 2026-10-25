-- v76: toate RPC-urile de programare verifica slotul sub advisory lock pe (salon, specialist)
-- si tin cont de google_busy_blocks (aceeasi logica ca list_busy_ranges).
-- Corpurile functiilor sunt luate din definitiile LIVE (pg_get_functiondef); s-a inlocuit doar
-- blocul duplicat "perform ... for update; if exists(...) then slot_taken" cu assert_slot_free.
-- Se pastreaza v71 (staff_service_mismatch) si v72 (offpeak_price o data pe ocurenta).

-- Eveniment Google = ocupat. Calendarul unui specialist blocheaza doar acel specialist;
-- calendarul salonului blocheaza doar daca salonul nu are specialisti activi (ca list_busy_ranges).
create or replace function public.has_google_busy_conflict(
  p_business_id uuid, p_staff_id uuid, p_start timestamptz, p_end timestamptz
) returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.google_busy_blocks g
      join public.google_calendar_connections c on c.business_id = g.business_id
     where g.business_id = p_business_id
       and g.start_at < p_end
       and g.end_at > p_start
       and case
         when c.staff_id is not null then p_staff_id is null or c.staff_id = p_staff_id
         else not exists (
           select 1 from public.staff s where s.business_id = p_business_id and s.active
         )
       end
  );
$$;

-- Serializeaza rezervarile pe acelasi (salon, specialist) pana la commit, apoi verifica.
-- Ridica 'slot_taken' (mesaj deja tratat in aplicatie).
create or replace function public.assert_slot_free(
  p_business_id uuid, p_staff_id uuid, p_start timestamptz, p_end timestamptz,
  p_buffer int, p_exclude_id uuid default null
) returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('slot:' || p_business_id::text || ':' || coalesce(p_staff_id::text, '-'), 0)
  );

  if exists (
    select 1 from public.appointments
     where business_id = p_business_id
       and (p_exclude_id is null or id <> p_exclude_id)
       and staff_id is not distinct from p_staff_id
       and public.appointment_blocks_slot(status)
       and start_at < public.busy_end_with_buffer(p_end, p_buffer)
       and public.busy_end_with_buffer(end_at, p_buffer) > p_start
  ) or public.has_google_busy_conflict(p_business_id, p_staff_id, p_start, p_end) then
    raise exception 'slot_taken';
  end if;
end;
$$;

revoke all on function public.has_google_busy_conflict(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.assert_slot_free(uuid, uuid, timestamptz, timestamptz, int, uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.business_create_walkin(p_business_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_service_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
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
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;
  if v_biz.owner_user_id <> v_user then
    raise exception 'not_business_owner';
  end if;

  v_phone := nullif(trim(coalesce(p_client_phone, '')), '');
  v_email := nullif(trim(coalesce(p_client_email, '')), '');
  if v_phone is null and v_email is null then
    raise exception 'walkin_contact_required';
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

  if p_start_at < now() - make_interval(mins => 5) then
    raise exception 'too_soon';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end, v_buffer);

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status,
    client_email, client_phone,
    service_id, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name,
    decision_notified, reminder_sent, attendance_confirmed
  ) values (
    p_business_id, v_user, p_start_at, v_end, 'approved',
    v_email, v_phone,
    v_svc_id, v_svc_name, v_duration,
    case when v_svc_price is null then null else v_svc_price end,
    'none', 0,
    v_staff_id, v_staff_name,
    true, false, false
  ) returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.business_move_appointment(p_appointment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  where a.id = p_appointment_id
    and b.owner_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_move';
  end if;

  if v_row.start_at <= now() then
    raise exception 'cannot_move';
  end if;

  select * into v_biz from public.business_profiles where id = v_row.business_id;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_row.service_duration_minutes, v_biz.session_duration_minutes);
  v_end := p_start_at + make_interval(mins => v_duration);

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at <= now() then
    raise exception 'move_in_past';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

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
$function$;

CREATE OR REPLACE FUNCTION public.create_appointment_if_free(p_business_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_service_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- v71: specialistul ales trebuie sa faca toate serviciile (fara randuri = face tot).
    if not public.staff_offers_services(v_staff_id, array_remove(array[p_service_id], null)) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    -- v71: „Oricine": primul specialist activ care face toate serviciile.
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
      and public.staff_offers_services(id, array_remove(array[p_service_id], null))
    order by sort_order, created_at
    limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
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

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end, v_buffer);

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
$function$;

CREATE OR REPLACE FUNCTION public.create_appointment_multi_if_free(p_business_id uuid, p_start_at timestamp with time zone, p_service_ids uuid[], p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- v71: specialistul ales trebuie sa faca toate serviciile (fara randuri = face tot).
    if not public.staff_offers_services(v_staff_id, p_service_ids) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    -- v71: „Oricine": primul specialist activ care face toate serviciile.
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
      and public.staff_offers_services(id, p_service_ids)
    order by sort_order, created_at
    limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
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

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end, v_buffer);

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
$function$;

CREATE OR REPLACE FUNCTION public.create_guest_appointment(p_business_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_service_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- v71: specialistul ales trebuie sa faca toate serviciile (fara randuri = face tot).
    if not public.staff_offers_services(v_staff_id, array_remove(array[p_service_id], null)) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    -- v71: „Oricine": primul specialist activ care face toate serviciile.
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
      and public.staff_offers_services(id, array_remove(array[p_service_id], null))
    order by sort_order, created_at
    limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
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

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end, v_buffer);

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
$function$;

CREATE OR REPLACE FUNCTION public.create_guest_appointment_multi(p_business_id uuid, p_start_at timestamp with time zone, p_service_ids uuid[], p_staff_id uuid DEFAULT NULL::uuid, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
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
  v_staff_id uuid;
  v_staff_name text;
  v_phone text;
  v_email text;
  v_name text;
  v_active int;
  v_row public.appointments;
begin
  if p_service_ids is null or cardinality(p_service_ids) = 0 then
    raise exception 'service_not_found';
  end if;

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
    -- v71: specialistul ales trebuie sa faca toate serviciile (fara randuri = face tot).
    if not public.staff_offers_services(v_staff_id, p_service_ids) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    -- v71: „Oricine": primul specialist activ care face toate serviciile.
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
      and public.staff_offers_services(id, p_service_ids)
    order by sort_order, created_at
    limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
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

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end, v_buffer);

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status,
    client_email, client_phone, guest_name,
    service_id, service_ids, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name,
    decision_notified, reminder_sent, reminder_24h_sent,
    attendance_confirmed, loyalty_redeemed, no_show
  ) values (
    p_business_id, null, p_start_at, v_end, 'pending',
    v_email, v_phone, v_name,
    v_svc_id, p_service_ids, v_svc_name, v_duration, v_svc_price,
    'none', 0,
    v_staff_id, v_staff_name,
    false, false, false,
    false, false, false
  ) returning * into v_row;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_recurring_appointments(p_business_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_service_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid, p_repeat_count integer DEFAULT 2)
 RETURNS SETOF appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_price numeric(10, 2);
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
    -- v71: specialistul ales trebuie sa faca toate serviciile (fara randuri = face tot).
    if not public.staff_offers_services(v_staff_id, array_remove(array[p_service_id], null)) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    -- v71: „Oricine": primul specialist activ care face toate serviciile.
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
      and public.staff_offers_services(id, array_remove(array[p_service_id], null))
    order by sort_order, created_at
    limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
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

    -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
    perform public.assert_slot_free(p_business_id, v_staff_id, v_slot, v_end, v_buffer);
  end loop;

  for v_i in 0..(v_count - 1) loop
    v_slot := timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), p_start_at) + make_interval(weeks => v_i));
    v_end := v_slot + make_interval(mins => v_duration);

    v_price := public.offpeak_price(p_business_id, v_slot, v_svc_price);

    insert into public.appointments (
      business_id, client_user_id, start_at, end_at, status,
      client_email, client_phone,
      service_id, service_name, service_duration_minutes, service_price,
      payment_status, deposit_ron,
      staff_id, staff_name, loyalty_redeemed, recurring_series_id
    ) values (
      p_business_id, v_user, v_slot, v_end, v_status,
      v_email, v_phone,
      v_svc_id, v_svc_name, v_duration, v_price,
      v_pay, v_deposit,
      v_staff_id, v_staff_name, false, v_series
    ) returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_recurring_multi_appointments(p_business_id uuid, p_start_at timestamp with time zone, p_service_ids uuid[], p_staff_id uuid DEFAULT NULL::uuid, p_repeat_count integer DEFAULT 2)
 RETURNS SETOF appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_price numeric(10, 2);
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
    -- v71: specialistul ales trebuie sa faca toate serviciile (fara randuri = face tot).
    if not public.staff_offers_services(v_staff_id, p_service_ids) then
      raise exception 'staff_service_mismatch';
    end if;
  else
    -- v71: „Oricine": primul specialist activ care face toate serviciile.
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
      and public.staff_offers_services(id, p_service_ids)
    order by sort_order, created_at
    limit 1;
    if not found and exists (
      select 1 from public.staff where business_id = p_business_id and active = true
    ) then
      raise exception 'staff_service_mismatch';
    end if;
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

    -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
    perform public.assert_slot_free(p_business_id, v_staff_id, v_slot, v_end, v_buffer);
  end loop;

  for v_i in 0..(v_count - 1) loop
    v_slot := timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), timezone(coalesce(v_biz.timezone, 'Europe/Bucharest'), p_start_at) + make_interval(weeks => v_i));
    v_end := v_slot + make_interval(mins => v_duration);

    v_price := public.offpeak_price(p_business_id, v_slot, v_svc_price);

    insert into public.appointments (
      business_id, client_user_id, start_at, end_at, status,
      client_email, client_phone,
      service_id, service_ids, service_name, service_duration_minutes, service_price,
      payment_status, deposit_ron,
      staff_id, staff_name, loyalty_redeemed, recurring_series_id
    ) values (
      p_business_id, v_user, v_slot, v_end, v_status,
      v_email, v_phone,
      v_svc_id, p_service_ids, v_svc_name, v_duration, v_price,
      v_pay, v_deposit,
      v_staff_id, v_staff_name, false, v_series
    ) returning * into v_row;

    return next v_row;
  end loop;

  return;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reschedule_appointment(p_appointment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
 RETURNS appointments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- v76: lock pe (salon, specialist) + programari + Google busy, totul sub lock.
  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

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
$function$;
