-- v81 (11b): trigger-ele care existau doar pe live, aduse în migrări fără schimbare de comportament.
-- Definițiile sunt copiate exact din pg_get_functiondef / pg_get_triggerdef (live, 2026-10-26).
-- Idempotent: create or replace function + drop trigger if exists / create trigger.

CREATE OR REPLACE FUNCTION public.appointment_insert_push_webhook()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform net.http_post(
    url := 'https://tucujqpgshrmljkmqvnl.supabase.co/functions/v1/notify-pending-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_secret' limit 1)
    ),
    body := jsonb_build_object('type', TG_OP, 'table', TG_TABLE_NAME, 'schema', TG_TABLE_SCHEMA, 'record', to_jsonb(NEW), 'old_record', null),
    timeout_milliseconds := 5000
  );
  return NEW;
end; $function$;

revoke all on function public.appointment_insert_push_webhook() from public, anon, authenticated;
grant execute on function public.appointment_insert_push_webhook() to service_role;

drop trigger if exists "appointment-insert-push" on public.appointments;
CREATE TRIGGER "appointment-insert-push" AFTER INSERT ON public.appointments FOR EACH ROW EXECUTE FUNCTION appointment_insert_push_webhook();

CREATE OR REPLACE FUNCTION public.notify_chat_push_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform net.http_post(
    url := 'https://tucujqpgshrmljkmqvnl.supabase.co/functions/v1/notify-chat-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_secret' limit 1)
    ),
    body := jsonb_build_object('record', row_to_json(NEW))
  );
  return NEW;
exception when others then return NEW;
end; $function$;

revoke all on function public.notify_chat_push_trigger() from public, anon, authenticated;
grant execute on function public.notify_chat_push_trigger() to service_role;

drop trigger if exists chat_messages_notify_push on public.chat_messages;
CREATE TRIGGER chat_messages_notify_push AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION notify_chat_push_trigger();
