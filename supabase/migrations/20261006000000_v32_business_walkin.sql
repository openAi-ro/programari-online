-- v32: business_create_walkin — programare manuala din calendar (walk-in / telefonic).
--
-- De ce RPC nou si nu insert direct:
-- - pe appointments nu exista policy de INSERT (doar via RPC security definer);
-- - owner-ul creeaza sedinta pentru un client care poate sa nu aiba cont;
-- - client_user_id ramane NOT NULL -> legam de owner, iar contactul real
--   (telefon/email) se salveaza in client_phone / client_email.
-- - statusul e direct 'approved' (business-ul nu isi aproba singur cereri);
-- - nu se aplica min_notice (clientul e deja in locatie / la telefon).

create or replace function public.business_create_walkin(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null,
  p_staff_id uuid default null,
  p_client_phone text default null,
  p_client_email text default null
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
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
$$;

revoke all on function public.business_create_walkin(uuid, timestamptz, timestamptz, uuid, uuid, text, text) from public;
grant execute on function public.business_create_walkin(uuid, timestamptz, timestamptz, uuid, uuid, text, text) to authenticated;
