-- v31: preferință WhatsApp pe profil (sync Cont → DB, nu doar AsyncStorage).
-- Edge functions (reminders / decision) citesc notify_whatsapp înainte de sendWhatsApp.

alter table public.profiles
  add column if not exists notify_whatsapp boolean not null default true;

comment on column public.profiles.notify_whatsapp is
  'Dacă false, telefonul rămâne contact dar fără mesaje WhatsApp (reminders/decision/test).';

notify pgrst, 'reload schema';
