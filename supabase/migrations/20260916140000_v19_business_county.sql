-- v19: județ separat de localitate, pentru adresă structurată din nomenclatorul oficial.

alter table public.business_profiles
  add column if not exists county text;

notify pgrst, 'reload schema';