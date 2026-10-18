-- v52: notification_log — one row per WhatsApp/email notification attempt.
-- Written only by Edge Functions (service role bypasses RLS); the business owner can read
-- the rows of their business. Status is updated by the whatsapp-webhook function (by wamid).

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  business_id uuid null references public.business_profiles(id) on delete cascade,
  appointment_id uuid null references public.appointments(id) on delete set null,
  channel text not null check (channel in ('whatsapp', 'email')),
  type text not null,
  to_masked text null,
  template text null,
  wamid text null,
  status text not null check (
    status in ('accepted', 'sent', 'delivered', 'read', 'failed', 'stub', 'invalid_phone')
  ),
  error_code text null,
  error_message text null
);

create unique index if not exists notification_log_wamid_uidx
  on public.notification_log (wamid) where wamid is not null;
create index if not exists notification_log_business_created_idx
  on public.notification_log (business_id, created_at desc);
create index if not exists notification_log_appointment_idx
  on public.notification_log (appointment_id) where appointment_id is not null;

alter table public.notification_log enable row level security;

revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;
grant all on public.notification_log to service_role;

drop policy if exists notification_log_owner_read on public.notification_log;
create policy notification_log_owner_read
  on public.notification_log
  for select
  to authenticated
  using (
    business_id is not null
    and exists (
      select 1
      from public.business_profiles b
      where b.id = notification_log.business_id
        and b.owner_user_id = (select auth.uid())
    )
  );

comment on table public.notification_log is
  'WhatsApp/email notification attempts (masked recipient). Service role writes; business owner reads.';
