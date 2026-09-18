-- v17: per-client notification preferences.
-- send-reminders and notify-decision respect these flags before contacting the client.

alter table public.profiles
  add column if not exists notify_reminders boolean not null default true,
  add column if not exists notify_decision boolean not null default true;

notify pgrst, 'reload schema';