-- v63: repara politicile de scriere business-media create in v60.
-- Cauza: in `exists (select 1 from business_profiles b where b.id::text =
-- (storage.foldername(name))[1] ...)`, identificatorul `name` era rezolvat de
-- Postgres la coloana business_profiles.name (domeniul cel mai intern), nu la
-- numele obiectului din storage.objects. Folderul comparat era numele firmei,
-- deci conditia nu era niciodata adevarata si orice upload era respins cu
-- "new row violates row-level security policy".
-- Reparatia: segmentul de cale se evalueaza IN AFARA subinterogarii (domeniul
-- politicii), iar subinterogarea aduce doar id-urile business-urilor proprii.

drop policy if exists business_media_owner_insert on storage.objects;
create policy business_media_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] in (
      select b.id::text
      from public.business_profiles b
      where b.owner_user_id = auth.uid()
    )
  );

drop policy if exists business_media_owner_update on storage.objects;
create policy business_media_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] in (
      select b.id::text
      from public.business_profiles b
      where b.owner_user_id = auth.uid()
    )
  );

drop policy if exists business_media_owner_delete on storage.objects;
create policy business_media_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-media'
    and (storage.foldername(name))[1] in (
      select b.id::text
      from public.business_profiles b
      where b.owner_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
