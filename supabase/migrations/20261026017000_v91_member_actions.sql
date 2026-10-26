-- v91: actiunile din Cereri respecta rolurile v89.
-- mark/clear no-show: owner/admin pe orice programare; staff doar pe programarile proprii.
-- delete_appointment_and_chats: doar owner/admin (angajatul nu sterge programari).

create or replace function public.mark_no_show(
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

  update public.appointments a
  set no_show = true,
      attendance_confirmed = false,
      updated_at = now()
  where a.id = p_appointment_id
    and a.status = 'approved'
    and a.start_at <= now()
    and a.no_show = false
    and (
      public.business_member_role(a.business_id) in ('owner', 'admin')
      or a.staff_id = public.business_member_staff_id(a.business_id)
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_mark_noshow';
  end if;

  return v_row;
end;
$$;

revoke all on function public.mark_no_show(uuid) from public, anon;
grant execute on function public.mark_no_show(uuid) to authenticated;

create or replace function public.clear_no_show(
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

  update public.appointments a
  set no_show = false,
      updated_at = now()
  where a.id = p_appointment_id
    and a.no_show = true
    and (
      public.business_member_role(a.business_id) in ('owner', 'admin')
      or a.staff_id = public.business_member_staff_id(a.business_id)
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_clear_noshow';
  end if;

  return v_row;
end;
$$;

revoke all on function public.clear_no_show(uuid) from public, anon;
grant execute on function public.clear_no_show(uuid) to authenticated;

-- Corp v38 (conversatia ramane intacta), garda pe membru owner/admin.
create or replace function public.delete_appointment_and_chats(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.appointments;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_app from public.appointments where id = p_appointment_id;
  if not found then raise exception 'appointment_not_found'; end if;
  if public.business_member_role(v_app.business_id) not in ('owner', 'admin') then
    raise exception 'not_owner';
  end if;

  delete from public.appointments where id = p_appointment_id;
  return jsonb_build_object('deleted_appointment', p_appointment_id, 'deleted_chats', 0);
end;
$$;

revoke all on function public.delete_appointment_and_chats(uuid) from public, anon;
grant execute on function public.delete_appointment_and_chats(uuid) to authenticated;

notify pgrst, 'reload schema';
