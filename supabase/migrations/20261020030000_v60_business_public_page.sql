-- v60: pagina publica de prezentare a business-ului (Faza 1)
-- Coloane noi pe business_profiles + bucket public 'business-media'
-- (coperta + galerie). Politicile de scriere copiaza modelul v53:
-- doar proprietarul business-ului din primul folder al caii (<business_id>/...).
-- NOTA: tiparul paginii (text generat din categorie/oras/servicii) traieste in app,
-- nu in DB. 'contact_phone' e telefonul PUBLIC al firmei (butoane Telefon/WhatsApp
-- pe pagina); nu are legatura cu telefonul contului de proprietar din profiles.

alter table public.business_profiles
  add column if not exists description text,
  add column if not exists cover_url text,
  add column if not exists gallery_urls text[] not null default '{}',
  add column if not exists website_enabled boolean not null default true,
  add column if not exists contact_phone text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'business_profiles_description_len_chk'
  ) then
    alter table public.business_profiles
      add constraint business_profiles_description_len_chk
      check (description is null or char_length(description) <= 1500);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'business_profiles_gallery_max_chk'
  ) then
    alter table public.business_profiles
      add constraint business_profiles_gallery_max_chk
      check (coalesce(array_length(gallery_urls, 1), 0) <= 12);
  end if;
end $$;

comment on column public.business_profiles.description is
  'Descriere publica a firmei (max 1500 caractere); goala = text generat din sablon in app.';
comment on column public.business_profiles.cover_url is
  'URL public al copertei paginii (bucket business-media); gol = poza categoriei.';
comment on column public.business_profiles.gallery_urls is
  'URL-uri publice ale galeriei firmei (bucket business-media), max 12.';
comment on column public.business_profiles.website_enabled is
  'false = pagina publica de prezentare oprita (mesaj indisponibil).';
comment on column public.business_profiles.contact_phone is
  'Telefon public al firmei, afisat pe pagina (apel + WhatsApp).';

-- ---------------------------------------------------------------------------
-- Bucket public pentru coperta + galerie
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-media',
  'business-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists business_media_public_read on storage.objects;
create policy business_media_public_read on storage.objects
  for select using (bucket_id = 'business-media');

drop policy if exists business_media_owner_insert on storage.objects;
create policy business_media_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-media'
    and exists (
      select 1 from public.business_profiles b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_user_id = auth.uid()
    )
  );

drop policy if exists business_media_owner_update on storage.objects;
create policy business_media_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-media'
    and exists (
      select 1 from public.business_profiles b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_user_id = auth.uid()
    )
  );

drop policy if exists business_media_owner_delete on storage.objects;
create policy business_media_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'business-media'
    and exists (
      select 1 from public.business_profiles b
      where b.id::text = (storage.foldername(name))[1]
        and b.owner_user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
