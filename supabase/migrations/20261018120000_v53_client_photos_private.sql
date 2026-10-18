-- v53: pozele inainte/dupa ale clientilor intr-un bucket PRIVAT.
-- Inainte: bucket public 'staff-photos' + URL public salvat in client_photos.url
-- (oricine avea linkul vedea poza). Acum: bucket privat 'client-photos',
-- in tabel se pastreaza doar calea din bucket; afisarea se face cu URL semnat.
-- Cale: {business_id}/{client_user_id}/{fisier}
-- Pozele echipei / portofoliul raman publice in 'staff-photos' (neatinse).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-photos', 'client-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Citire: proprietarul business-ului din cale SAU clientul din cale.
drop policy if exists client_photos_read on storage.objects;
create policy client_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-photos'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or exists (
        select 1 from public.business_profiles b
        where b.id::text = (storage.foldername(name))[1]
          and b.owner_user_id = auth.uid()
      )
    )
  );

-- Scriere / modificare / stergere: doar proprietarul business-ului din cale.
drop policy if exists client_photos_owner_insert on storage.objects;
create policy client_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-photos'
    and exists (
      select 1 from public.business_profiles b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_user_id = auth.uid()
    )
  );

drop policy if exists client_photos_owner_update on storage.objects;
create policy client_photos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-photos'
    and exists (
      select 1 from public.business_profiles b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_user_id = auth.uid()
    )
  );

drop policy if exists client_photos_owner_delete on storage.objects;
create policy client_photos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-photos'
    and exists (
      select 1 from public.business_profiles b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_user_id = auth.uid()
    )
  );

-- Tabelul: URL-ul public devine cale in bucket-ul privat.
-- (pe live tabelul e gol la 18.10.2026 — nu exista fisiere de mutat)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_photos' and column_name = 'url'
  ) then
    alter table public.client_photos rename column url to storage_path;
  end if;
end $$;

-- randuri vechi (daca ar exista): URL public .../staff-photos/client-photos/{biz}/{client}/{f} -> {biz}/{client}/{f}
update public.client_photos
  set storage_path = regexp_replace(storage_path, '^.*/staff-photos/client-photos/', '')
  where storage_path like '%/staff-photos/client-photos/%';

notify pgrst, 'reload schema';
