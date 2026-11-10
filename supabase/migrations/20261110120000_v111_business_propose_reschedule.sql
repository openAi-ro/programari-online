-- v111: propunere de mutare de la salon + tinerea slotului cerut/propus
--
-- 1) Coloana reschedule_proposed_by: 'client' | 'business' | null
--    (null pe randuri vechi cu cerere = tratat ca 'client' in RPC-uri).
-- 2) business_propose_reschedule: salonul propune ora NOUA fara a muta start_at;
--    necesita client_user_id (cont). Mutarea directa ramane business_move_appointment.
-- 3) client_accept_reschedule / client_decline_reschedule: raspunsul clientului.
-- 4) business_accept/decline: doar pentru propuneri de la client.
-- 5) assert_slot_free + list_busy_ranges: blocheaza si requested_start/end
--    (repara gaura v87 unde textul zicea ca e rezervat, dar serverul nu tinea slotul).
-- 6) expire_reschedule_requests intoarce si cine a propus, ca reminder-ul sa anunte corect.
--
-- NU atinge v103. Aplicare pe live doar cu OK separat.

alter table public.appointments
  add column if not exists reschedule_proposed_by text;

do $chk$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'appointments_reschedule_proposed_by_chk'
  ) then
    alter table public.appointments
      add constraint appointments_reschedule_proposed_by_chk
      check (
        reschedule_proposed_by is null
        or reschedule_proposed_by in ('client', 'business')
      );
  end if;
end;
$chk$;

comment on column public.appointments.reschedule_proposed_by is
  'v111: cine a cerut ora din requested_*: client sau business. Null = cerere veche (tratata ca client).';

update public.appointments
   set reschedule_proposed_by = 'client'
 where requested_start_at is not null
   and reschedule_proposed_by is null;

create or replace function public.assert_slot_free(
  p_business_id uuid,
  p_staff_id uuid,
  p_start timestamp with time zone,
  p_end timestamp with time zone,
  p_buffer integer,
  p_exclude_id uuid default null
)
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_staff_id is null then
    perform pg_advisory_xact_lock(hashtextextended('slot:' || p_business_id::text || ':-', 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('slot:' || p_business_id::text || ':-', 0));
    perform pg_advisory_xact_lock(hashtextextended('slot:' || p_business_id::text || ':' || p_staff_id::text, 0));
  end if;

  if public.staff_unavailable_conflict(p_business_id, p_staff_id, p_start, p_end) then
    raise exception 'staff_unavailable';
  end if;

  if exists (
    select 1 from public.appointments a
     where a.business_id = p_business_id
       and (p_exclude_id is null or a.id <> p_exclude_id)
       and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
       and public.appointment_blocks_slot(a.status)
       and (
         (a.start_at < public.busy_end_with_buffer(p_end, p_buffer)
          and public.busy_end_with_buffer(a.end_at, p_buffer) > p_start)
         or (
           a.requested_start_at is not null
           and a.requested_end_at is not null
           and a.requested_start_at < public.busy_end_with_buffer(p_end, p_buffer)
           and public.busy_end_with_buffer(a.requested_end_at, p_buffer) > p_start
         )
       )
  ) or public.has_google_busy_conflict(p_business_id, p_staff_id, p_start, p_end) then
    raise exception 'slot_taken';
  end if;
end;
$function$;

create or replace function public.list_busy_ranges(
  p_business_id uuid,
  p_from timestamp with time zone,
  p_to timestamp with time zone,
  p_staff_id uuid default null
)
returns table(start_at timestamp with time zone, end_at timestamp with time zone)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select x.start_at, x.end_at
    from (
      select a.start_at, a.end_at
        from public.appointments a
       where a.business_id = p_business_id
         and public.appointment_blocks_slot(a.status)
         and a.start_at < p_to
         and a.end_at > p_from
         and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
      union all
      select a.requested_start_at, a.requested_end_at
        from public.appointments a
       where a.business_id = p_business_id
         and public.appointment_blocks_slot(a.status)
         and a.requested_start_at is not null
         and a.requested_end_at is not null
         and a.requested_start_at < p_to
         and a.requested_end_at > p_from
         and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
      union all
      select g.start_at, g.end_at
        from public.google_busy_blocks g
        join public.google_calendar_connections c on c.business_id = g.business_id
       where g.business_id = p_business_id
         and g.start_at < p_to
         and g.end_at > p_from
         and case
               when c.staff_id is not null then p_staff_id is null or c.staff_id = p_staff_id
               else not exists (select 1 from public.staff s
                                 where s.business_id = p_business_id and s.active)
             end
      union all
      select (u.start_date::timestamp at time zone b.timezone),
             ((u.end_date + 1)::timestamp at time zone b.timezone)
        from public.staff_unavailability u
        join public.business_profiles b on b.id = u.business_id
       where u.business_id = p_business_id
         and (p_staff_id is null or u.staff_id = p_staff_id)
         and (u.start_date::timestamp at time zone b.timezone) < p_to
         and ((u.end_date + 1)::timestamp at time zone b.timezone) > p_from
    ) x
   where public.business_visible(p_business_id);
$function$;

revoke all on function public.list_busy_ranges(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.list_busy_ranges(uuid, timestamptz, timestamptz, uuid) to anon, authenticated, service_role;

-- reschedule_appointment: marcheaza propunerile clientului
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_start_at timestamp with time zone,
  p_end_at timestamp with time zone
)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_notice int;
  v_direct boolean;
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

  v_direct := v_row.status = 'pending'
    or (coalesce(v_biz.auto_approve_returning, false)
        and exists (
          select 1 from public.appointments
          where business_id = v_row.business_id
            and client_user_id = v_user
            and status = 'approved'
        ));

  if not v_direct and least(v_row.start_at, p_start_at) < now() + interval '2 hours' then
    raise exception 'too_late';
  end if;

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

  if v_direct then
    update public.appointments
    set start_at = p_start_at,
        end_at = v_end,
        requested_start_at = null,
        requested_end_at = null,
        reschedule_requested_at = null,
        reschedule_proposed_by = null,
        reminder_sent = false,
        reminder_24h_sent = false,
        attendance_confirmed = false,
        updated_at = now()
    where id = p_appointment_id
    returning * into v_row;
  else
    update public.appointments
    set requested_start_at = p_start_at,
        requested_end_at = v_end,
        reschedule_requested_at = now(),
        reschedule_proposed_by = 'client',
        updated_at = now()
    where id = p_appointment_id
    returning * into v_row;
  end if;

  return v_row;
end;
$function$;

-- Salonul PROPUNE o ora (fara mutare directa). Doar clienti cu cont.
create or replace function public.business_propose_reschedule(
  p_appointment_id uuid,
  p_start_at timestamp with time zone,
  p_end_at timestamp with time zone
)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row from public.appointments a where a.id = p_appointment_id;
  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  v_role := public.business_member_role(v_row.business_id);
  if v_role is null
     or (v_role = 'staff' and v_row.staff_id is distinct from public.business_member_staff_id(v_row.business_id)) then
    raise exception 'not_business_owner';
  end if;

  if v_row.client_user_id is null then
    raise exception 'no_client_account';
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

  if least(v_row.start_at, p_start_at) < now() + interval '2 hours' then
    raise exception 'too_late';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

  update public.appointments
  set requested_start_at = p_start_at,
      requested_end_at = v_end,
      reschedule_requested_at = now(),
      reschedule_proposed_by = 'business',
      updated_at = now()
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.business_propose_reschedule(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.business_propose_reschedule(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Accept/refuz salon: doar cereri de la client (sau legacy null).
create or replace function public.business_accept_reschedule(p_appointment_id uuid)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_buffer int;
  v_by text;
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
  if v_row.requested_start_at is null then
    raise exception 'no_reschedule_request';
  end if;

  v_by := coalesce(v_row.reschedule_proposed_by, 'client');
  if v_by <> 'client' then
    raise exception 'not_client_proposal';
  end if;

  if v_row.requested_start_at <= now() then
    raise exception 'reschedule_expired';
  end if;

  select coalesce(buffer_minutes, 0) into v_buffer
    from public.business_profiles where id = v_row.business_id;

  perform public.assert_slot_free(
    v_row.business_id, v_row.staff_id, v_row.requested_start_at, v_row.requested_end_at,
    coalesce(v_buffer, 0), v_row.id
  );

  update public.appointments
  set start_at = v_row.requested_start_at,
      end_at = v_row.requested_end_at,
      requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reschedule_proposed_by = null,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      updated_at = now()
  where id = v_row.id
    and requested_start_at = v_row.requested_start_at
    and status in ('pending', 'approved')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'reschedule_changed';
  end if;

  return v_row;
end;
$function$;

create or replace function public.business_decline_reschedule(p_appointment_id uuid)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_by text;
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

  if v_row.requested_start_at is null then
    raise exception 'no_reschedule_request';
  end if;

  v_by := coalesce(v_row.reschedule_proposed_by, 'client');
  if v_by <> 'client' then
    raise exception 'not_client_proposal';
  end if;

  update public.appointments
  set requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reschedule_proposed_by = null,
      updated_at = now()
  where id = v_row.id
    and requested_start_at is not null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no_reschedule_request';
  end if;

  return v_row;
end;
$function$;

-- Clientul accepta propunerea salonului.
create or replace function public.client_accept_reschedule(p_appointment_id uuid)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_buffer int;
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
  if v_row.requested_start_at is null then
    raise exception 'no_reschedule_request';
  end if;
  if coalesce(v_row.reschedule_proposed_by, 'client') <> 'business' then
    raise exception 'not_business_proposal';
  end if;
  if v_row.requested_start_at <= now() then
    raise exception 'reschedule_expired';
  end if;

  select coalesce(buffer_minutes, 0) into v_buffer
    from public.business_profiles where id = v_row.business_id;

  perform public.assert_slot_free(
    v_row.business_id, v_row.staff_id, v_row.requested_start_at, v_row.requested_end_at,
    coalesce(v_buffer, 0), v_row.id
  );

  update public.appointments
  set start_at = v_row.requested_start_at,
      end_at = v_row.requested_end_at,
      requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reschedule_proposed_by = null,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      moved_by_business_at = now(),
      moved_seen_at = now(),
      updated_at = now()
  where id = v_row.id
    and requested_start_at = v_row.requested_start_at
    and status in ('pending', 'approved')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'reschedule_changed';
  end if;

  return v_row;
end;
$function$;

create or replace function public.client_decline_reschedule(p_appointment_id uuid)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
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
  if v_row.requested_start_at is null then
    raise exception 'no_reschedule_request';
  end if;
  if coalesce(v_row.reschedule_proposed_by, 'client') <> 'business' then
    raise exception 'not_business_proposal';
  end if;

  update public.appointments
  set requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reschedule_proposed_by = null,
      updated_at = now()
  where id = v_row.id
    and requested_start_at is not null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no_reschedule_request';
  end if;

  return v_row;
end;
$function$;

revoke all on function public.client_accept_reschedule(uuid) from public, anon;
grant execute on function public.client_accept_reschedule(uuid) to authenticated, service_role;
revoke all on function public.client_decline_reschedule(uuid) from public, anon;
grant execute on function public.client_decline_reschedule(uuid) to authenticated, service_role;

-- Mutare directa (Mută acum): curata si propunerea in asteptare.
create or replace function public.business_move_appointment(
  p_appointment_id uuid,
  p_start_at timestamp with time zone,
  p_end_at timestamp with time zone
)
returns appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row from public.appointments a where a.id = p_appointment_id;
  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  v_role := public.business_member_role(v_row.business_id);
  if v_role is null
     or (v_role = 'staff' and v_row.staff_id is distinct from public.business_member_staff_id(v_row.business_id)) then
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

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

  update public.appointments
  set start_at = p_start_at,
      end_at = v_end,
      requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reschedule_proposed_by = null,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      moved_by_business_at = now(),
      moved_seen_at = null,
      updated_at = now()
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end;
$function$;

-- Expirare: intoarce si cine a propus (inainte de clear).
-- Tipul de return se schimba (adauga r_proposed_by) => DROP obligatoriu.
drop function if exists public.expire_reschedule_requests();
create or replace function public.expire_reschedule_requests()
returns table(
  r_id uuid,
  r_business_id uuid,
  r_client_user_id uuid,
  r_client_email text,
  r_client_phone text,
  r_start_at timestamp with time zone,
  r_requested_start_at timestamp with time zone,
  r_notify_client boolean,
  r_proposed_by text
)
language sql
set search_path to 'public', 'pg_temp'
as $function$
  with due as (
    select a.id,
           a.requested_start_at as old_requested,
           coalesce(a.reschedule_proposed_by, 'client') as old_by
    from public.appointments a
    where a.requested_start_at is not null
      and (
        not public.appointment_blocks_slot(a.status)
        or least(a.start_at, a.requested_start_at) <= now() + interval '2 hours'
      )
    for update skip locked
  )
  update public.appointments a
     set requested_start_at = null,
         requested_end_at = null,
         reschedule_requested_at = null,
         reschedule_proposed_by = null,
         updated_at = now()
    from due
   where a.id = due.id
  returning a.id, a.business_id, a.client_user_id, a.client_email, a.client_phone, a.start_at,
            due.old_requested, public.appointment_blocks_slot(a.status), due.old_by;
$function$;

revoke all on function public.expire_reschedule_requests() from public, anon, authenticated;
grant execute on function public.expire_reschedule_requests() to service_role;

revoke all on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.business_move_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.business_move_appointment(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.business_accept_reschedule(uuid) from public, anon;
grant execute on function public.business_accept_reschedule(uuid) to authenticated, service_role;
revoke all on function public.business_decline_reschedule(uuid) from public, anon;
grant execute on function public.business_decline_reschedule(uuid) to authenticated, service_role;
revoke all on function public.assert_slot_free(uuid, uuid, timestamptz, timestamptz, integer, uuid) from public, anon;
grant execute on function public.assert_slot_free(uuid, uuid, timestamptz, timestamptz, integer, uuid) to authenticated, service_role;


-- Amânarea (postpone) anulează orice propunere în așteptare.
create or replace function public.postpone_appointment_checked(p_appointment_id uuid, p_hours integer)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.appointments;
  v_buffer int;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_hours is null or p_hours < 1 or p_hours > 12 then
    raise exception 'invalid_hours';
  end if;

  select * into v_row from public.appointments where id = p_appointment_id for update;
  if v_row.id is null then
    raise exception 'appointment_not_found';
  end if;
  if v_row.status not in ('pending', 'approved') then
    raise exception 'status_not_postponeable';
  end if;

  select coalesce(buffer_minutes, 0) into v_buffer
    from public.business_profiles where id = v_row.business_id;

  v_start := v_row.start_at + make_interval(hours => p_hours);
  v_end := v_row.end_at + make_interval(hours => p_hours);

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, v_start, v_end, coalesce(v_buffer, 0), v_row.id);

  update public.appointments
     set start_at = v_start,
         end_at = v_end,
         requested_start_at = null,
         requested_end_at = null,
         reschedule_requested_at = null,
         reschedule_proposed_by = null,
         reminder_sent = false,
         reminder_24h_sent = false,
         attendance_confirmed = false,
         moved_by_business_at = now(),
         moved_seen_at = null,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;
