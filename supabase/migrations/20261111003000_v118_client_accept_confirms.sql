-- v118 (retest 3.24, F-D): când clientul acceptă ora propusă de salon pe o cerere încă
-- „În așteptare”, programarea devine Confirmată (salonul a ales ora, deci o acceptă).
-- Înainte rămânea pending și salonul trebuia s-o aprobe separat.
-- TypeSafe jev-1.14.0 (r2/e2): is_bug 0,81; „devine Confirmată” 0,89.
-- Doar înlocuiește corpul funcției v111 (aceeași semnătură, aceleași GRANT-uri).
-- Notificarea „confirmată” către client pleacă prin fluxul existent (decision_notified=false:
-- webhook / cron v113), o singură dată. Pe programările deja confirmate nu schimbă nimic.
-- NU e aplicată pe live: se aplică la publicarea 3.25, cu OK-ul lui Rafael.

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
      -- v118 (F-D): ora a ales-o salonul, deci acceptarea clientului confirmă și cererea.
      status = 'approved',
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
