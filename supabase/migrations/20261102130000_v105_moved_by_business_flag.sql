-- v105 (post-audit F-12): clientul vede în aplicație când salonul îi mută programarea.
--
-- Două coloane noi pe appointments:
--   moved_by_business_at – setată la fiecare mutare făcută de salon;
--   moved_seen_at        – setată de client când ia la cunoștință (butonul „Am înțeles").
-- Cât timp moved_by_business_at e setat și moved_seen_at e gol, aplicația arată
-- bannerul „Salonul ți-a mutat programarea". Coloanele sunt doar informative:
-- nu schimbă statusul, slotul sau notificările existente.
--
-- Corpurile de mai jos pornesc de la ultimele definiții locale (v89 pentru mutare,
-- v87 pentru amânare) și adaugă doar marcajul; comportamentul existent e neschimbat
-- (inclusiv ștergerea cererilor de reprogramare la mutare, din v87).

alter table public.appointments
  add column if not exists moved_by_business_at timestamptz,
  add column if not exists moved_seen_at timestamptz;

-- business_move_appointment (corp v89): owner/admin liber; staff muta doar programarile proprii.
create or replace function public.business_move_appointment(p_appointment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
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

  select a.* into v_row
  from public.appointments a
  where a.id = p_appointment_id;

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

-- Confirmarea clientului că a văzut mutarea. Nu schimbă nimic altceva.
create or replace function public.ack_moved_appointment(p_appointment_id uuid)
returns public.appointments
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

  update public.appointments
  set moved_seen_at = now()
  where id = p_appointment_id
    and client_user_id = v_user
    and moved_by_business_at is not null
    and moved_seen_at is null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'nothing_to_ack';
  end if;

  return v_row;
end;
$function$;

revoke all on function public.ack_moved_appointment(uuid) from public, anon;
grant execute on function public.ack_moved_appointment(uuid) to authenticated;

notify pgrst, 'reload schema';
