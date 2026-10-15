-- v39: tara business-ului (cele 30 de tari: UE-27 + UK + MD + TR).
-- business_profiles.country = cod ISO alpha-2 ('RO', 'GB', ...).
-- Randurile existente sunt din Romania (locatia era doar RO pana la v38).

alter table public.business_profiles
  add column if not exists country text;

-- Coloana poate exista deja (v38_country pe remote, text nulabil fara default):
-- o aducem la contractul v39 = implicit 'RO', fara null.
alter table public.business_profiles
  alter column country set default 'RO';
update public.business_profiles
  set country = 'RO'
  where country is null or trim(country) = '';
alter table public.business_profiles
  alter column country set not null;

comment on column public.business_profiles.country is
  'Cod ISO tara (RO/GB/MD/TR/...). Implicit RO pentru business-urile vechi.';

create index if not exists business_profiles_country_idx
  on public.business_profiles (country);

-- RPC-ul public expune country (superset de coloane: v30 category/video + v33 timezone).
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
  timezone text,
  promo_video_url text,
  category text,
  country text
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
      b.timezone,
      b.promo_video_url,
      b.category,
      coalesce(b.country, 'RO') as country
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
    to_jsonb(base.working_hours) as working_hours,
    base.timezone,
    base.promo_video_url,
    base.category,
    base.country
  from base;
$$;

comment on function public.list_public_businesses(text, text, int, text) is
  'Descoperire: campuri publice + rating + program + timezone + video + categorie + tara.';

revoke all on function public.list_public_businesses(text, text, int, text) from public;
grant execute on function public.list_public_businesses(text, text, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
