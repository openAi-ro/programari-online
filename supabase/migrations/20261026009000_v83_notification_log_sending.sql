-- Pas 11d.2: send-reminders rezerva randul din notification_log ('sending') inainte de trimitere,
-- apoi il actualizeaza cu rezultatul. Un rand ramas 'sending' conteaza ca trimis (fara dubluri).
alter table public.notification_log drop constraint if exists notification_log_status_check;
alter table public.notification_log add constraint notification_log_status_check
  check (status = any (array['sending','accepted','sent','delivered','read','failed','stub','invalid_phone']::text[]));