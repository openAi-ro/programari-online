-- v23: poza de profil (caseta din Setări) — același dreptunghi 52×52 în UI
alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do nothing;

drop policy if exists profile_avatars_public_read on storage.objects;
create policy profile_avatars_public_read on storage.objects
  for select using (bucket_id = 'profile-avatars');

drop policy if exists profile_avatars_owner_write on storage.objects;
create policy profile_avatars_owner_write on storage.objects
  for insert with check (
    bucket_id = 'profile-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_avatars_owner_update on storage.objects;
create policy profile_avatars_owner_update on storage.objects
  for update using (
    bucket_id = 'profile-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists profile_avatars_owner_delete on storage.objects;
create policy profile_avatars_owner_delete on storage.objects
  for delete using (
    bucket_id = 'profile-avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
