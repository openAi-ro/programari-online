-- v24: logo firmă pe business (separat de profiles.avatar_url)
alter table public.business_profiles
  add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('business-logos', 'business-logos', true)
on conflict (id) do nothing;

drop policy if exists business_logos_public_read on storage.objects;
create policy business_logos_public_read on storage.objects
  for select using (bucket_id = 'business-logos');

drop policy if exists business_logos_owner_write on storage.objects;
create policy business_logos_owner_write on storage.objects
  for insert with check (
    bucket_id = 'business-logos'
    and auth.role() = 'authenticated'
  );

drop policy if exists business_logos_owner_update on storage.objects;
create policy business_logos_owner_update on storage.objects
  for update using (
    bucket_id = 'business-logos'
    and auth.role() = 'authenticated'
  );

drop policy if exists business_logos_owner_delete on storage.objects;
create policy business_logos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'business-logos'
    and auth.role() = 'authenticated'
  );
