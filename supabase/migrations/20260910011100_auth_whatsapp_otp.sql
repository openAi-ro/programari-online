-- Custom WhatsApp OTP auth (service-role only; no client RLS policies)
create table public.auth_whatsapp_otps (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index auth_whatsapp_otps_phone_active_idx
  on public.auth_whatsapp_otps (phone)
  where consumed_at is null;

alter table public.auth_whatsapp_otps enable row level security;

-- No policies for anon/authenticated → client Data API blocked; service_role bypasses RLS
revoke all on table public.auth_whatsapp_otps from anon, authenticated;
grant all on table public.auth_whatsapp_otps to service_role;

-- profiles.phone already exists (text); E.164 is app convention — no schema change required