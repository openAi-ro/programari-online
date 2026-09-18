-- v18: locație business (adresă + hartă), ca clienții să ajungă ușor la locație.

alter table public.business_profiles
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists maps_url text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'business_profiles_latitude_chk'
      and conrelid = 'public.business_profiles'::regclass
  ) then
    alter table public.business_profiles
      add constraint business_profiles_latitude_chk
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'business_profiles_longitude_chk'
      and conrelid = 'public.business_profiles'::regclass
  ) then
    alter table public.business_profiles
      add constraint business_profiles_longitude_chk
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end;
$$;

notify pgrst, 'reload schema';