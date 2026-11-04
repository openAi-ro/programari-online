-- v107: abonamente Web Push pentru PWA (iOS-2).
-- Pe iPhone aplicația rulează ca PWA instalată; Expo Push nu ajunge acolo.
-- Tabelul păstrează endpoint-ul PushManager al browserului, separat de
-- device_push_tokens (tokeni Expo nativi). Cheile p256dh/auth sunt secretele
-- de criptare ale abonamentului, accesibile doar proprietarului prin RLS.

create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.web_push_subscriptions enable row level security;

create policy web_push_subscriptions_own on public.web_push_subscriptions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.web_push_subscriptions to authenticated;
grant select, insert, update, delete on public.web_push_subscriptions to service_role;

notify pgrst, 'reload schema';
