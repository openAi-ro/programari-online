-- v56: pozele inainte/dupa doar cu acordul clientului, verificat pe server.
-- 1) Business-ul poate doar CITI fisa clientului (inainte putea s-o si modifice,
--    deci isi putea bifa singur acordul foto). Fisa o scrie doar clientul.
drop policy if exists intake_owner_all on public.client_intake;
drop policy if exists intake_owner_select on public.client_intake;
create policy intake_owner_select on public.client_intake
  for select to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));

-- 2) Randul pozei: proprietarul business-ului il poate vedea/sterge; il poate
--    adauga doar daca fisa clientului pentru acel business are photo_consent = true.
drop policy if exists photos_owner_all on public.client_photos;
drop policy if exists photos_owner_select on public.client_photos;
drop policy if exists photos_owner_delete on public.client_photos;
drop policy if exists photos_owner_insert on public.client_photos;
create policy photos_owner_select on public.client_photos
  for select to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));
create policy photos_owner_delete on public.client_photos
  for delete to authenticated
  using (auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id));
create policy photos_owner_insert on public.client_photos
  for insert to authenticated
  with check (
    auth.uid() in (select owner_user_id from public.business_profiles b where b.id = client_photos.business_id)
    and exists (
      select 1 from public.client_intake i
      where i.business_id = client_photos.business_id
        and i.client_user_id = client_photos.client_user_id
        and i.photo_consent
    )
  );

-- 3) Fisierul: aceeasi conditie la upload in bucket-ul privat (cale {business}/{client}/...).
drop policy if exists client_photos_owner_insert on storage.objects;
create policy client_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-photos'
    and (storage.foldername(name))[1] in (
      select b.id::text from public.business_profiles b where b.owner_user_id = auth.uid()
    )
    and ((storage.foldername(name))[1], (storage.foldername(name))[2]) in (
      select i.business_id::text, i.client_user_id::text from public.client_intake i where i.photo_consent
    )
  );

-- Upload-urile nu se suprascriu (upsert: false), deci update pe fisiere nu e necesar.
drop policy if exists client_photos_owner_update on storage.objects;
