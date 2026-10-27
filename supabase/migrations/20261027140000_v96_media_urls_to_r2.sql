-- v96: point presentation media URLs at the Cloudflare R2 Worker.
-- Files were copied to R2 bucket programari-media under the same keys
-- (<bucket>/<folder>/<file>, 40 objects, sizes verified) before this ran.
-- Only the URL changes; Supabase storage copies are kept until Rafael approves deleting them.
-- Every old value is recorded in public.media_url_migration_log (rollback below).

create table if not exists public.media_url_migration_log (
  id bigserial primary key,
  table_name text not null,
  row_id uuid not null,
  column_name text not null,
  old_value jsonb,
  new_value jsonb,
  migrated_at timestamptz not null default now()
);
alter table public.media_url_migration_log enable row level security;
revoke all on public.media_url_migration_log from anon, authenticated;

create or replace function public._media_url_to_r2(p_url text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_url ~ '^https://tucujqpgshrmljkmqvnl\.supabase\.co/storage/v1/object/public/(business-videos|business-media|business-logos|staff-photos|profile-avatars)/'
      and exists (
        select 1 from storage.objects o
        where o.bucket_id || '/' || o.name = split_part(regexp_replace(p_url, '^https://tucujqpgshrmljkmqvnl\.supabase\.co/storage/v1/object/public/', ''), '?', 1)
      )
    then 'https://programari-media.rafaeldanescu.workers.dev/m/'
      || split_part(regexp_replace(p_url, '^https://tucujqpgshrmljkmqvnl\.supabase\.co/storage/v1/object/public/', ''), '?', 1)
    else p_url
  end;
$$;

do $$
declare
  r record;
begin
  -- business_profiles: logo, cover, promo video, gallery
  for r in
    select id, logo_url, cover_url, promo_video_url, gallery_urls from public.business_profiles
  loop
    if r.logo_url is distinct from public._media_url_to_r2(r.logo_url) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('business_profiles', r.id, 'logo_url', to_jsonb(r.logo_url), to_jsonb(public._media_url_to_r2(r.logo_url)));
      update public.business_profiles set logo_url = public._media_url_to_r2(r.logo_url) where id = r.id;
    end if;
    if r.cover_url is distinct from public._media_url_to_r2(r.cover_url) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('business_profiles', r.id, 'cover_url', to_jsonb(r.cover_url), to_jsonb(public._media_url_to_r2(r.cover_url)));
      update public.business_profiles set cover_url = public._media_url_to_r2(r.cover_url) where id = r.id;
    end if;
    if r.promo_video_url is distinct from public._media_url_to_r2(r.promo_video_url) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('business_profiles', r.id, 'promo_video_url', to_jsonb(r.promo_video_url), to_jsonb(public._media_url_to_r2(r.promo_video_url)));
      update public.business_profiles set promo_video_url = public._media_url_to_r2(r.promo_video_url) where id = r.id;
    end if;
    if r.gallery_urls is not null
      and r.gallery_urls is distinct from coalesce((select array_agg(public._media_url_to_r2(u) order by i) from unnest(r.gallery_urls) with ordinality t(u, i)), '{}'::text[]) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('business_profiles', r.id, 'gallery_urls', to_jsonb(r.gallery_urls),
        to_jsonb(coalesce((select array_agg(public._media_url_to_r2(u) order by i) from unnest(r.gallery_urls) with ordinality t(u, i)), '{}'::text[])));
      update public.business_profiles
        set gallery_urls = coalesce((select array_agg(public._media_url_to_r2(u) order by i) from unnest(r.gallery_urls) with ordinality t(u, i)), '{}'::text[])
        where id = r.id;
    end if;
  end loop;

  -- profiles.avatar_url
  for r in select id, avatar_url from public.profiles where avatar_url is not null loop
    if r.avatar_url is distinct from public._media_url_to_r2(r.avatar_url) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('profiles', r.id, 'avatar_url', to_jsonb(r.avatar_url), to_jsonb(public._media_url_to_r2(r.avatar_url)));
      update public.profiles set avatar_url = public._media_url_to_r2(r.avatar_url) where id = r.id;
    end if;
  end loop;

  -- staff: photo + portfolio
  for r in select id, photo_url, portfolio_urls from public.staff loop
    if r.photo_url is distinct from public._media_url_to_r2(r.photo_url) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('staff', r.id, 'photo_url', to_jsonb(r.photo_url), to_jsonb(public._media_url_to_r2(r.photo_url)));
      update public.staff set photo_url = public._media_url_to_r2(r.photo_url) where id = r.id;
    end if;
    if r.portfolio_urls is not null
      and r.portfolio_urls is distinct from coalesce((select array_agg(public._media_url_to_r2(u) order by i) from unnest(r.portfolio_urls) with ordinality t(u, i)), '{}'::text[]) then
      insert into public.media_url_migration_log (table_name, row_id, column_name, old_value, new_value)
      values ('staff', r.id, 'portfolio_urls', to_jsonb(r.portfolio_urls),
        to_jsonb(coalesce((select array_agg(public._media_url_to_r2(u) order by i) from unnest(r.portfolio_urls) with ordinality t(u, i)), '{}'::text[])));
      update public.staff
        set portfolio_urls = coalesce((select array_agg(public._media_url_to_r2(u) order by i) from unnest(r.portfolio_urls) with ordinality t(u, i)), '{}'::text[])
        where id = r.id;
    end if;
  end loop;
end $$;

drop function public._media_url_to_r2(text);

-- Rollback (run manually if needed), newest values back to the logged old ones:
-- update public.business_profiles b set logo_url = l.old_value #>> '{}' from public.media_url_migration_log l
--   where l.table_name = 'business_profiles' and l.column_name = 'logo_url' and l.row_id = b.id;
-- (same for cover_url, promo_video_url, profiles.avatar_url, staff.photo_url;
--  for arrays: set gallery_urls = array(select jsonb_array_elements_text(l.old_value)), same for staff.portfolio_urls)
