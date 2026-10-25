-- v80: anti-spam pentru programarile fara cont (create_guest_appointment / _multi).
--
-- Inainte (v35..v76): doar "max 3 programari active viitoare per contact per salon",
-- comparat pe text exact si fara lock. Se ocolea cu:
--   * alt format al aceluiasi contact (0712.. vs +40712.., majuscule in email);
--   * cereri paralele (count-ul nu era serializat);
--   * contacte rotite (nicio limita pe salon / global);
--   * nume / email / telefon fara validare (ajung in notificarile catre salon).
--
-- Acum, o singura functie de garda folosita de ambele RPC-uri:
--   1) validare: nume <= 80 caractere (invalid_name), telefon 9..15 cifre doar cu
--      + spatiu ( ) . - (invalid_phone), email <= 254 si forma a@b.c (invalid_email);
--   2) cheie normalizata: telefon = ultimele 9 cifre, email = lower(trim);
--   3) advisory lock pe fiecare cheie de contact, apoi pe salon (ordine fixa, fara deadlock;
--      assert_slot_free ia ulterior lock-ul (salon, specialist));
--   4) limite:
--        - max 3 programari active viitoare per contact la acelasi salon   -> too_many_guest
--        - max 5 programari fara cont create in 24h de acelasi contact (toate saloanele)
--                                                                      -> guest_rate_limited
--        - max 10 programari fara cont create intr-o ora la acelasi salon -> guest_rate_limited
--   Invitat = client_user_id is null (walk-in-urile din business_create_walkin au client_user_id).

create or replace function public.guest_phone_key(p_phone text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select nullif(right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9), '')
$$;

create or replace function public.assert_guest_booking_allowed(
  p_business_id uuid,
  p_phone text,
  p_email text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone_key text := public.guest_phone_key(p_phone);
  v_email_key text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_digits int;
  v_count int;
begin
  if p_name is not null and char_length(p_name) > 80 then
    raise exception 'invalid_name';
  end if;
  if p_phone is not null then
    v_digits := char_length(regexp_replace(p_phone, '\D', '', 'g'));
    if v_digits < 9 or v_digits > 15 or p_phone !~ '^\+?[0-9 ().-]+$' then
      raise exception 'invalid_phone';
    end if;
  end if;
  if v_email_key is not null
     and (char_length(v_email_key) > 254 or v_email_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'invalid_email';
  end if;

  if v_phone_key is not null then
    perform pg_advisory_xact_lock(hashtext('guest_contact:p:' || v_phone_key));
  end if;
  if v_email_key is not null then
    perform pg_advisory_xact_lock(hashtext('guest_contact:e:' || v_email_key));
  end if;
  perform pg_advisory_xact_lock(hashtext('guest_business:' || p_business_id::text));

  select count(*) into v_count
  from public.appointments
  where business_id = p_business_id
    and status in ('pending', 'approved')
    and start_at > now()
    and (
      (v_phone_key is not null and public.guest_phone_key(client_phone) = v_phone_key)
      or (v_email_key is not null and lower(client_email) = v_email_key)
    );
  if v_count >= 3 then
    raise exception 'too_many_guest';
  end if;

  select count(*) into v_count
  from public.appointments
  where client_user_id is null
    and created_at > now() - interval '24 hours'
    and (
      (v_phone_key is not null and public.guest_phone_key(client_phone) = v_phone_key)
      or (v_email_key is not null and lower(client_email) = v_email_key)
    );
  if v_count >= 5 then
    raise exception 'guest_rate_limited';
  end if;

  select count(*) into v_count
  from public.appointments
  where business_id = p_business_id
    and client_user_id is null
    and created_at > now() - interval '1 hour';
  if v_count >= 10 then
    raise exception 'guest_rate_limited';
  end if;
end;
$function$;

revoke all on function public.assert_guest_booking_allowed(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.assert_guest_booking_allowed(uuid, text, text, text) to service_role;

create index if not exists appointments_guest_created_idx
  on public.appointments (business_id, created_at)
  where client_user_id is null;

create or replace function public.create_guest_appointment(p_business_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_service_id uuid DEFAULT NULL::uuid, p_staff_id uuid DEFAULT NULL::uuid, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text)
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

  -- v80: validare + limite anti-spam pentru invitati, serializate pe contact si pe salon.
  perform public.assert_guest_booking_allowed(p_business_id, v_phone, v_email, v_name);
  v_email := lower(v_email);

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

create or replace function public.create_guest_appointment_multi(p_business_id uuid, p_start_at timestamp with time zone, p_service_ids uuid[], p_staff_id uuid DEFAULT NULL::uuid, p_client_name text DEFAULT NULL::text, p_client_phone text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text)
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

  -- v80: validare + limite anti-spam pentru invitati, serializate pe contact si pe salon.
  perform public.assert_guest_booking_allowed(p_business_id, v_phone, v_email, v_name);
  v_email := lower(v_email);

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
