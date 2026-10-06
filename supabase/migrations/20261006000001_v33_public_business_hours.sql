-- v33: lista publica include programul si timezone-ul pentru badge-ul "Deschis acum".
-- Aditiv: doar coloane noi in returns table; apelantii vechi ignora campurile extra.
-- NU rula db push din task-uri de app — migrarea se aplica separat pe Supabase.

create or replace function public.list_public_businesses(
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
  timezone text
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
      b.timezone
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
    base.timezone
  from base;
$$;

revoke all on function public.list_public_businesses(text, text, int) from public;
grant execute on function public.list_public_businesses(text, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
