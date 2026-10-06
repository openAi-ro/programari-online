-- v34: business_move_appointment — muta o programare pe alt slot (din Cereri).
--
-- Spre deosebire de reschedule_appointment (doar clientul propriu), aici
-- apelantul trebuie sa fie owner-ul business-ului. Nu se aplica min_notice
-- (business-ul poate muta pe cineva aflat deja in locatie), dar se aplica
-- max_advance, zile blocate si verificarea de suprapunere (staff-aware).

create or replace function public.business_move_appointment(
  p_appointment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
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

  if exists (
    select 1 from public.appointments
    where business_id = v_row.business_id
      and id <> p_appointment_id
      and staff_id is not distinct from v_row.staff_id
      and public.appointment_blocks_slot(status)
      and start_at < public.busy_end_with_buffer(v_end, v_buffer)
      and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

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
$$;

revoke all on function public.business_move_appointment(uuid, timestamptz, timestamptz) from public;
grant execute on function public.business_move_appointment(uuid, timestamptz, timestamptz) to authenticated;
