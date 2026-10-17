-- v47: clientul anunta sosirea ("am ajuns"); firma vede marcajul in calendar
alter table public.appointments
  add column if not exists checked_in_at timestamptz;

create or replace function public.mark_checked_in(p_appointment_id uuid)
returns public.appointments
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

  update public.appointments
  set checked_in_at = coalesce(checked_in_at, now())
  where id = p_appointment_id
    and client_user_id = v_user
    and status = 'approved'
    and checked_in_at is null
    and start_at >= now() - interval '4 hours'
    and start_at <= now() + interval '60 minutes'
  returning * into v_row;

  if not found then
    raise exception 'checkin_not_allowed';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_checked_in(uuid) from public;
grant execute on function public.mark_checked_in(uuid) to authenticated;

notify pgrst, 'reload schema';
