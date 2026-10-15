-- v38: tara pentru profiluri (client) si business (adresa), cod ISO-2 din
-- nomenclatorul aplicatiei (lib/countries.ts). Validarea valorilor se face
-- in aplicatie; coloanele raman text nulabil pentru compatibilitate.
-- (Migrare deja aplicata pe remote intr-o alta sesiune; fisier recreat local
-- din supabase_migrations.schema_migrations ca istoricul sa coincida.)

alter table public.profiles
  add column if not exists country text;

alter table public.business_profiles
  add column if not exists country text;

comment on column public.profiles.country is 'Client country (ISO-2 from app country list).';
comment on column public.business_profiles.country is 'Business country (ISO-2 from app country list).';
