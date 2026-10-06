-- v21: business poate sterge o sedinta si chaturile legate (din casuta programare)
create or replace function public.delete_appointment_and_chats(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid := auth.uid();
  v_app public.appointments;
  v_is_owner boolean;
  v_deleted_chats int := 0;
  v_has_other boolean;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_app from public.appointments where id=p_appointment_id;
  if not found then raise exception 'appointment_not_found'; end if;
  select exists(select 1 from public.business_profiles b where b.id=v_app.business_id and b.owner_user_id=v_user) into v_is_owner;
  if not v_is_owner then raise exception 'not_owner'; end if;

  delete from public.appointments where id=p_appointment_id;

  -- daca nu mai are programari cu acel client, sterge conversatia (si mesajele via cascade)
  select exists(select 1 from public.appointments where business_id=v_app.business_id and client_user_id=v_app.client_user_id) into v_has_other;
  if not v_has_other then
    delete from public.chat_conversations where business_id=v_app.business_id and client_user_id=v_app.client_user_id;
    v_deleted_chats := 1;
  end if;

  return jsonb_build_object('deleted_appointment', p_appointment_id, 'deleted_chats', v_deleted_chats);
end;
$$;
revoke all on function public.delete_appointment_and_chats(uuid) from public;
grant execute on function public.delete_appointment_and_chats(uuid) to authenticated;
notify pgrst, 'reload schema';
