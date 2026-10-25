-- v74: securizare storage pentru business-logos, business-videos, staff-photos.
-- Inainte: INSERT/UPDATE/DELETE permise oricarui utilizator autentificat (auth.role()='authenticated'),
-- deci oricine putea suprascrie/sterge logo-ul, video-ul sau pozele echipei altui salon.
-- Acum: scrierea e permisa doar proprietarului salonului din primul segment al caii
-- (<business_id>/<fisier>), exact cum urca aplicatia (settings.tsx, businessVideo.ts, staff.tsx).
-- Staff nu are cont propriu (tabela staff nu are user_id), deci la staff-photos scrie doar proprietarul.
-- Citirea ramane publica (bucketurile sunt publice). Idempotent.
-- ATENTIE: in subquery scriem objects.name; un "name" simplu s-ar lega de business_profiles.name.

-- 1) Politicile prea largi: le stergem (nu adaugam peste ele).
drop policy if exists business_logos_owner_write  on storage.objects;
drop policy if exists business_logos_owner_update on storage.objects;
drop policy if exists business_logos_owner_delete on storage.objects;
drop policy if exists business_videos_owner_write  on storage.objects;
drop policy if exists business_videos_owner_update on storage.objects;
drop policy if exists business_videos_owner_delete on storage.objects;
drop policy if exists staff_photos_owner_write  on storage.objects;
drop policy if exists staff_photos_owner_update on storage.objects;
drop policy if exists staff_photos_owner_delete on storage.objects;

-- Numele noi (pentru re-rulare).
drop policy if exists business_logos_owner_insert  on storage.objects;
drop policy if exists business_videos_owner_insert on storage.objects;
drop policy if exists staff_photos_owner_insert    on storage.objects;

-- 2) business-logos
create policy business_logos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );
create policy business_logos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-logos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  )
  with check (
    bucket_id = 'business-logos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );
create policy business_logos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-logos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );

-- 3) business-videos
create policy business_videos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-videos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );
create policy business_videos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-videos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  )
  with check (
    bucket_id = 'business-videos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );
create policy business_videos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-videos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );

-- 4) staff-photos (doar proprietarul salonului; staff nu are cont)
create policy staff_photos_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'staff-photos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );
create policy staff_photos_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'staff-photos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  )
  with check (
    bucket_id = 'staff-photos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );
create policy staff_photos_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'staff-photos'
    and exists (select 1 from public.business_profiles b
                where b.id::text = (storage.foldername(objects.name))[1] and b.owner_user_id = auth.uid())
  );

-- SELECT public ramane neschimbat: business_logos_public_read, business_videos_public_read,
-- staff_photos_public_read (bucket_id = '<bucket>').

-- 5) Limite pe bucket. Fisiere existente: logo max 431 KB, staff max 1.3 MB, video max 29.4 MB;
-- tipuri existente: image/jpeg, image/png, video/mp4. Aplicatia urca imagini ca image/jpeg sau image/png
-- (uploadLocalImage.ts) si video mp4/mov/webm cu limita 50 MB (videoRules.ts).
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id in ('business-logos', 'staff-photos');

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['video/mp4','video/webm','video/quicktime']
 where id = 'business-videos';