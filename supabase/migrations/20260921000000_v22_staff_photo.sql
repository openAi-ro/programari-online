-- v22: poza de profil pentru specialisti (badge rotund)
alter table public.staff
  add column if not exists photo_url text;

-- bucket public pentru pozele echipei
insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', true)
on conflict (id) do nothing;

drop policy if exists staff_photos_public_read on storage.objects;
create policy staff_photos_public_read on storage.objects
  for select using (bucket_id = 'staff-photos');

drop policy if exists staff_photos_owner_write on storage.objects;
create policy staff_photos_owner_write on storage.objects
  for insert with check (bucket_id = 'staff-photos' and auth.role() = 'authenticated');

drop policy if exists staff_photos_owner_update on storage.objects;
create policy staff_photos_owner_update on storage.objects
  for update using (bucket_id = 'staff-photos' and auth.role() = 'authenticated');

drop policy if exists staff_photos_owner_delete on storage.objects;
create policy staff_photos_owner_delete on storage.objects
  for delete using (bucket_id = 'staff-photos' and auth.role() = 'authenticated');
