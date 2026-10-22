-- security_definer_execute_grants: aplicata direct pe live (21.10.2026) din alta sesiune, fara fisier local.
-- Fisier recreat 1:1 din supabase_migrations.schema_migrations ca istoricul local sa fie sincron.

-- security: limit EXECUTE on SECURITY DEFINER functions (backup: secdef_functions_grants.json)
revoke execute on function public.block_client(uuid,uuid,text) from anon;
revoke execute on function public.business_create_walkin(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,text,text) from anon;
revoke execute on function public.business_move_appointment(uuid,timestamp with time zone,timestamp with time zone) from anon;
revoke execute on function public.business_report(integer) from anon;
revoke execute on function public.cancel_appointment(uuid) from anon;
revoke execute on function public.cancel_recurring_series(uuid) from anon;
revoke execute on function public.chat_conversation_from_appointment() from public, anon, authenticated;
revoke execute on function public.chat_message_set_last_message_at() from public, anon, authenticated;
revoke execute on function public.chat_unread_counts() from anon;
revoke execute on function public.check_gift_card(text) from anon;
revoke execute on function public.clear_no_show(uuid) from anon;
revoke execute on function public.confirm_attendance(uuid) from anon;
revoke execute on function public.create_appointment_if_free(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid) from anon;
revoke execute on function public.create_appointment_multi_if_free(uuid,timestamp with time zone,uuid[],uuid) from anon;
revoke execute on function public.create_recurring_appointments(uuid,timestamp with time zone,timestamp with time zone,uuid,uuid,integer) from anon;
revoke execute on function public.create_recurring_multi_appointments(uuid,timestamp with time zone,uuid[],uuid,integer) from anon;
revoke execute on function public.delete_appointment_and_chats(uuid) from anon;
revoke execute on function public.disconnect_google_calendar(uuid) from anon;
revoke execute on function public.ensure_chat_conversation(uuid) from anon;
revoke execute on function public.ensure_chat_conversation_for_client(uuid,uuid) from anon;
revoke execute on function public.ensure_default_staff() from public, anon, authenticated;
revoke execute on function public.get_google_calendar_status(uuid) from anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.insert_chat_message(uuid,text) from anon;
revoke execute on function public.join_waitlist(uuid,date,uuid,uuid) from anon;
revoke execute on function public.leave_waitlist(uuid) from anon;
revoke execute on function public.list_business_clients() from anon;
revoke execute on function public.mark_chat_conversation_read(uuid) from anon;
revoke execute on function public.mark_checked_in(uuid) from anon;
revoke execute on function public.mark_deposit_paid(uuid) from anon;
revoke execute on function public.mark_no_show(uuid) from anon;
revoke execute on function public.notify_chat_push_trigger() from public, anon, authenticated;
revoke execute on function public.record_referral(text) from anon;
revoke execute on function public.reply_to_review(uuid,text) from anon;
revoke execute on function public.reschedule_appointment(uuid,timestamp with time zone,timestamp with time zone) from anon;
revoke execute on function public.submit_review(uuid,integer,text) from anon;
revoke execute on function public.unblock_client(uuid,uuid) from anon;
revoke execute on function public.waive_deposit(uuid) from anon;
alter function public.appointment_blocks_slot(appointment_status) set search_path = public, pg_temp;
alter function public.busy_end_with_buffer(timestamp with time zone,integer) set search_path = public, pg_temp;
