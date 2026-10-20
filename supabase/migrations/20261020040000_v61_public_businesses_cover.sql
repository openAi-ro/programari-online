-- v61: RPC-ul public de descoperire expune si cover_url (Faza 1, carusel).
-- Pe live exista doua semnaturi (v30 cu p_category, v33 cu timezone);
-- ambele se recreeaza identic + cover_url la final. DROP+CREATE in aceeasi
-- tranzactie de migrare (CREATE OR REPLACE nu permite schimbarea returns table).

drop function if exists public.list_public_businesses(text, text, int);
drop function if exists public.list_public_businesses(text, text, int, text);

-- Semnatura v33 (3 parametri, cu timezone)
create function public.list_public_businesses(
  p_q text default null,
  p_city text default null,
  p_limit int default 100
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
  cover_url text
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
      b.cover_url
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
    base.cover_url
  from base;
$$;

-- Semnatura v30 (4 parametri, cu p_category, promo si categorie)
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
  category text,
  cover_url text
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
      b.category,
      b.cover_url
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
    base.category,
    base.cover_url
  from base;
$$;

comment on function public.list_public_businesses(text, text, int) is
  'Descoperire saloane: câmpuri publice + rating + program + timezone + copertă.';
comment on function public.list_public_businesses(text, text, int, text) is
  'Descoperire: câmpuri publice + rating + program + video + categorie + copertă.';

revoke all on function public.list_public_businesses(text, text, int) from public;
revoke all on function public.list_public_businesses(text, text, int, text) from public;
grant execute on function public.list_public_businesses(text, text, int) to anon, authenticated;
grant execute on function public.list_public_businesses(text, text, int, text) to anon, authenticated;

notify pgrst, 'reload schema';
