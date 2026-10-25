-- v79: amânarea (notify-postpone) verifică suprapunerile (pasul 9).
-- Înainte, funcția edge muta direct start/end cu 1-12h, fără verificare: putea suprapune
-- altă programare a aceluiași specialist sau un interval ocupat în Google Calendar.
-- Acum mutarea se face aici, sub același lock ca la rezervare (assert_slot_free, v76).

create or replace function public.postpone_appointment_checked(
  p_appointment_id uuid,
  p_hours int
) returns public.appointments
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
         reminder_sent = false,
         reminder_24h_sent = false,
         attendance_confirmed = false,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.postpone_appointment_checked(uuid, int) from public, anon, authenticated;
grant execute on function public.postpone_appointment_checked(uuid, int) to service_role;
