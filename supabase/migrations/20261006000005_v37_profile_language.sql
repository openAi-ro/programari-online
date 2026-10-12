-- v37: recipient language for notifications (RO default, EN opt-in from Settings).
alter table public.profiles
  add column if not exists language text not null default 'ro'
  check (language in ('ro', 'en'));

comment on column public.profiles.language is 'UI language (ro|en), synced from the app; edge functions localize notifications.';
