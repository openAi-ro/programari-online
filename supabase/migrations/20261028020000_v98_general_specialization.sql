-- v98 (3.02): categoria „General” + specializare scrisă de business.
-- Specializarea există DOAR pentru category = 'general' (2–40 caractere) și e căutabilă.
-- Promovarea unei specializări la categorie proprie rămâne manuală (release), pe baza
-- view-ului specialization_stats (citibil doar de service_role).

alter table public.business_profiles
  add column if not exists specialization text;

alter table public.business_profiles
  drop constraint if exists business_profiles_specialization_check;
alter table public.business_profiles
  add constraint business_profiles_specialization_check check (
    (category = 'general'
      and specialization is not null
      and specialization = btrim(specialization)
      and char_length(specialization) between 2 and 40)
    or (coalesce(category, '') <> 'general' and specialization is null)
  );

-- Tipul de retur se schimbă (coloana specialization) → drop + create.
drop function if exists public.list_public_businesses(text, text, integer, text);

create function public.list_public_businesses(
  p_q text default null,
  p_city text default null,
  p_limit integer default 100,
  p_category text default null
)
returns table(
  id uuid, name text, public_code text, city text, county text, country text, address text,
  latitude double precision, longitude double precision, logo_url text, maps_url text,
  avg_rating numeric, review_count bigint, working_hours jsonb, timezone text,
  promo_video_url text, category text, cover_url text, website_enabled boolean,
  specialization text
)
language sql
stable security definer
set search_path to 'public'
as $function$
  with base as (
    select b.*
      from public.business_profiles b
     where (
             p_q is null
             or length(trim(p_q)) = 0
             or b.name ilike '%' || trim(p_q) || '%'
             or b.public_code ilike '%' || trim(p_q) || '%'
             or coalesce(b.specialization, '') ilike '%' || trim(p_q) || '%'
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
    base.id, base.name, base.public_code, base.city, base.county, base.country, base.address,
    base.latitude, base.longitude, base.logo_url, base.maps_url,
    br.avg_rating, coalesce(br.review_count, 0)::bigint,
    to_jsonb(base.working_hours), base.timezone, base.promo_video_url, base.category,
    base.cover_url, base.website_enabled, base.specialization
  from base
  left join lateral public.business_rating(base.id) br on true
  order by base.name asc;
$function$;

revoke all on function public.list_public_businesses(text, text, integer, text) from public;
grant execute on function public.list_public_businesses(text, text, integer, text) to anon, authenticated, service_role;

-- Statistici pentru promovarea manuală a specializărilor (doar service_role).
create or replace view public.specialization_stats
with (security_invoker = true) as
  select lower(b.specialization) as specialization_key,
         min(b.specialization) as example,
         count(*)::bigint as businesses,
         max(b.updated_at) as last_updated_at
    from public.business_profiles b
   where b.category = 'general' and b.specialization is not null
   group by lower(b.specialization);

revoke all on public.specialization_stats from public, anon, authenticated;
grant select on public.specialization_stats to service_role;
