-- Client can cancel own appointment (pending or approved) -> status cancelled (slot freed)
create or replace function public.cancel_appointment(
  p_appointment_id uuid
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  -- Only the client who owns the appointment can cancel it
  if not exists (
    select 1 from public.appointments
    where id = p_appointment_id and client_user_id = v_user
  ) then
    raise exception 'not_owner';
  end if;

  update public.appointments
  set status = 'cancelled',
      updated_at = now()
  where id = p_appointment_id
    and status in ('pending', 'approved')
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_cancel';
  end if;

  return v_row;
end;
$$;

-- Only authenticated can cancel
grant execute on function public.cancel_appointment(uuid) to authenticated;
revoke all on function public.cancel_appointment(uuid) from public;