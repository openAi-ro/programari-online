-- Local/ops: assign browse categories to real businesses + cleanup test seeds.
-- Applied 2026-10-02 via `supabase db query --linked` (not a migration; data-only).
-- Mapping:
--   frizerie  <- Frizerie, Frizerie/Barbershop, Ionut Barbershop (name/services)
--   coafura   <- Salon Test Locație (salon)
--   left null <- Clubul de Foto, m m (no matching BROWSE_CATEGORIES key)

update public.business_profiles
set category = 'frizerie', updated_at = now()
where public_code in ('131sp6d5dl', 'v35hit4q8j', 'zt0a7cr372');

update public.business_profiles
set category = 'coafura', updated_at = now()
where public_code = 'salontestloc1';

delete from public.business_profiles
where public_code like 'testcat_%';
