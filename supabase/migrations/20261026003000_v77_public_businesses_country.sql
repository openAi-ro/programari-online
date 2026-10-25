-- v77: list_public_businesses - o singura functie (fara overload-uri divergente).
-- Inainte: varianta (q, city, limit) apelata de aplicatie nu intorcea category/promo_video_url,
-- iar niciuna nu intorcea country (filtrul de tara din browse nu mergea pe RPC).
-- Rating-ul se calculeaza o singura data pe rand, prin LATERAL.
-- Apelul aplicatiei { p_q, p_city, p_limit } ramane compatibil (p_category are default).

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
  country text,
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
  cover_url text,
  website_enabled boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select b.*
      from public.business_profiles b
     where (
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
    base.country,
    base.address,
    base.latitude,
    base.longitude,
    base.logo_url,
    base.maps_url,
    br.avg_rating,
    coalesce(br.review_count, 0)::bigint,
    to_jsonb(base.working_hours),
    base.timezone,
    base.promo_video_url,
    base.category,
    base.cover_url,
    base.website_enabled
  from base
  left join lateral public.business_rating(base.id) br on true
  order by base.name asc;
$$;

comment on function public.list_public_businesses(text, text, int, text) is
  'v77: lista publica pentru descoperire (inclusiv country), rating prin LATERAL.';

revoke all on function public.list_public_businesses(text, text, int, text) from public;
grant execute on function public.list_public_businesses(text, text, int, text) to anon, authenticated;