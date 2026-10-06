-- v30: categorie business pentru tile-urile din Caută (client).
-- Cheile trebuie să coincidă cu BROWSE_CATEGORIES.key din apps/mobile/lib/browseCategories.ts.
-- NU rula db push din acest task — Rafael aplică migrarea pe Supabase când e gata.

alter table public.business_profiles
  add column if not exists category text;

comment on column public.business_profiles.category is
  'Cheie categorie browse (ex. coafura, frizerie). Folosită de lista publică / filtrare client.';

create index if not exists business_profiles_category_idx
  on public.business_profiles (category)
  where category is not null;

-- Recreează RPC-ul public ca să expună category (și să filtreze opțional pe p_category).
drop function if exists public.list_public_businesses(text, text, int);
drop function if exists public.list_public_businesses(text, text, int, text);

create function public.list_public_businesses(
  p_q text default null,
  p_city text default null,
  p_limit int default 100,
  p_category text default null
)
returns table (
  id uuid,
  name text,
  public_code text,
  city text,
  county text,
  address text,
  latitude double precision,
  longitude double precision,
  logo_url text,
  maps_url text,
  avg_rating numeric,
  review_count bigint,
  working_hours jsonb,
  promo_video_url text,
  category text
)
language sql
security definer
stable
set search_path = public
as $$
  with base as (
    select
      b.id,
      b.name,
      b.public_code,
      b.city,
      b.county,
      b.address,
      b.latitude,
      b.longitude,
      b.logo_url,
      b.maps_url,
      b.working_hours,
      b.promo_video_url,
      b.category
    from public.business_profiles b
    where
      (
        p_q is null
        or length(trim(p_q)) = 0
        or b.name ilike '%' || trim(p_q) || '%'
        or b.public_code ilike '%' || trim(p_q) || '%'
      )
      and (
        p_city is null
        or length(trim(p_city)) = 0
        or coalesce(b.city, '') ilike '%' || trim(p_city) || '%'
        or coalesce(b.county, '') ilike '%' || trim(p_city) || '%'
      )
      and (
        p_category is null
        or length(trim(p_category)) = 0
        or b.category = trim(p_category)
      )
    order by b.name asc
    limit greatest(1, least(coalesce(p_limit, 100), 200))
  )
  select
    base.id,
    base.name,
    base.public_code,
    base.city,
    base.county,
    base.address,
    base.latitude,
    base.longitude,
    base.logo_url,
    base.maps_url,
    (select br.avg_rating from public.business_rating(base.id) br) as avg_rating,
    (select br.review_count from public.business_rating(base.id) br) as review_count,
    base.working_hours,
    base.promo_video_url,
    base.category
  from base;
$$;

comment on function public.list_public_businesses(text, text, int, text) is
  'Descoperire: câmpuri publice + rating + program + video + categorie. Folosit de browse / near-me.';

revoke all on function public.list_public_businesses(text, text, int, text) from public;
grant execute on function public.list_public_businesses(text, text, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
