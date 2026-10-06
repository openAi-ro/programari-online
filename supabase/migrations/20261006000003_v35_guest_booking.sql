-- v35: rezervare ca invitat (fara cont) de pe pagina publica /b/{cod}.
--
-- Schema: client_user_id devine NULL pentru invitati (profilul cere auth.users,
-- deci invitatul nu poate avea rand in profiles). Contactul real sta in
-- client_phone / client_email (constraintul appointments_contact_chk ramane),
-- iar numele in noua coloana guest_name.
-- Anti-spam: max 3 programari active viitoare per contact + business.
-- Statusul e mereu 'pending' (owner-ul aproba dupa verificare telefonica).

alter table public.appointments
  alter column client_user_id drop not null;

alter table public.appointments
  add column if not exists guest_name text;

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

revoke all on function public.create_guest_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text, text, text) from public;
grant execute on function public.create_guest_appointment(uuid, timestamptz, timestamptz, uuid, uuid, text, text, text) to anon, authenticated;
