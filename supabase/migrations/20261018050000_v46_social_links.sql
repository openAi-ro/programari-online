-- v46: retele sociale ale firmei, afisate pe pagina publica de rezervare
alter table public.business_profiles
  add column if not exists instagram_url text,
  add column if not exists facebook_url text;
