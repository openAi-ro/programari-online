-- v54: repara politicile din v53. In subquery-ul pe business_profiles,
-- `name` se rezolva la business_profiles.name (nu la storage.objects.name),
-- deci proprietarul nu putea incarca/citi. Calea se citeste acum IN AFARA
-- subquery-ului: folder[1] = business-ul, folder[2] = clientul.

drop policy if exists client_photos_read on storage.objects;
create policy client_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-photos'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or (storage.foldername(name))[1] in (
        select b.id::text from public.business_profiles b where b.owner_user_id = auth.uid()
      )
    )
  );

drop policy if exists client_photos_owner_insert on storage.objects;
create policy client_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.business_profiles b where b.owner_user_id = auth.uid()
    )
  );

drop policy if exists client_photos_owner_update on storage.objects;
create policy client_photos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.business_profiles b where b.owner_user_id = auth.uid()
    )
  );

drop policy if exists client_photos_owner_delete on storage.objects;
create policy client_photos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.business_profiles b where b.owner_user_id = auth.uid()
    )
  );
