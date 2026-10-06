-- v28: video de prezentare al business-ului (inregistrat din app, afisat clientilor).
alter table public.business_profiles
  add column if not exists promo_video_url text;

insert into storage.buckets (id, name, public)
values ('business-videos', 'business-videos', true)
on conflict (id) do nothing;

drop policy if exists business_videos_public_read on storage.objects;
create policy business_videos_public_read on storage.objects
  for select using (bucket_id = 'business-videos');

drop policy if exists business_videos_owner_write on storage.objects;
create policy business_videos_owner_write on storage.objects
  for insert with check (
    bucket_id = 'business-videos'
    and auth.role() = 'authenticated'
  );

drop policy if exists business_videos_owner_update on storage.objects;
create policy business_videos_owner_update on storage.objects
  for update using (
    bucket_id = 'business-videos'
    and auth.role() = 'authenticated'
  );

drop policy if exists business_videos_owner_delete on storage.objects;
create policy business_videos_owner_delete on storage.objects
  for delete using (
    bucket_id = 'business-videos'
    and auth.role() = 'authenticated'
  );
