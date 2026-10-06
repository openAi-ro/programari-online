-- v26: listă publică de business-uri pentru descoperire (browse / near-me).
-- Context: RLS pe business_profiles permite deja SELECT pentru anon + authenticated
-- (business_select_anon / business_select_authenticated). RPC-ul există ca:
--   1) suprafață sigură (doar câmpuri publice, fără owner_user_id / ore / etc.)
--   2) filtrare server-side după nume/oraș
--   3) rating agregat (reviews) într-un singur round-trip
-- App-ul face fallback la SELECT direct dacă RPC-ul nu e încă aplicat pe proiect.
-- NU rula db push din acest task — Rafael aplică migrarea pe Supabase când e gata.

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
  review_count bigint
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
      b.maps_url
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
    (select br.review_count from public.business_rating(base.id) br) as review_count
  from base;
$$;

comment on function public.list_public_businesses(text, text, int) is
  'Descoperire saloane: câmpuri publice + rating. Folosit de browse / near-me.';

revoke all on function public.list_public_businesses(text, text, int) from public;
grant execute on function public.list_public_businesses(text, text, int) to anon, authenticated;

notify pgrst, 'reload schema';
