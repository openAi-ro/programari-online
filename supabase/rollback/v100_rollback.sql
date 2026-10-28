-- Rollback pentru v100_private_business_rls (3.02). Readuce politicile și RPC-urile
-- exact la starea de dinainte de v100 (după v98/v99, care rămân aplicate).
-- Rulare: Supabase SQL editor sau MCP execute_sql, ca o singură tranzacție.
begin;

drop trigger if exists appointments_private_business_guard on public.appointments;
drop trigger if exists waitlist_private_business_guard on public.waitlist;
drop trigger if exists chat_conversations_private_business_guard on public.chat_conversations;
drop function if exists public.enforce_private_business_access();

drop policy if exists business_select_anon on public.business_profiles;
create policy business_select_anon on public.business_profiles for select to anon using (true);
drop policy if exists business_select_authenticated on public.business_profiles;
create policy business_select_authenticated on public.business_profiles for select to authenticated using (true);

drop policy if exists services_select_anon on public.services;
create policy services_select_anon on public.services for select to anon using (active = true);
drop policy if exists services_select_authenticated on public.services;
create policy services_select_authenticated on public.services for select to authenticated using (
  (active = true) or ((select auth.uid()) in (select b.owner_user_id from public.business_profiles b where b.id = services.business_id)));

drop policy if exists staff_select_anon on public.staff;
create policy staff_select_anon on public.staff for select to anon using (active = true);
drop policy if exists staff_select_authenticated on public.staff;
create policy staff_select_authenticated on public.staff for select to authenticated using (
  (active = true) or ((select auth.uid()) in (select b.owner_user_id from public.business_profiles b where b.id = staff.business_id)));

create or replace function public.business_rating(p_business_id uuid)
returns table(avg_rating numeric, review_count bigint)
language sql stable security definer set search_path to 'public'
as $function$
  select round(avg(r.rating)::numeric, 1), count(*)::bigint from public.reviews r where r.business_id = p_business_id;
$function$;

create or replace function public.get_public_staff_phones(p_business_id uuid)
returns table(staff_id uuid, phone text)
language sql stable security definer set search_path to 'public'
as $function$
  select sp.staff_id, sp.phone from public.staff_private sp join public.staff s on s.id = sp.staff_id
   where s.business_id = p_business_id and s.active = true and sp.phone_public = true
     and sp.phone is not null and length(trim(sp.phone)) > 0;
$function$;

create or replace function public.list_public_reviews(p_business_id uuid, p_limit integer default 3)
returns table(rating integer, comment text, created_at timestamptz, owner_reply text)
language sql stable security definer set search_path to 'public'
as $function$
  select r.rating, left(coalesce(r.comment, ''), 160), r.created_at, left(coalesce(r.owner_reply, ''), 160)
    from public.reviews r
   where r.business_id = p_business_id and r.rating between 1 and 5
     and (select count(*) from public.reviews c where c.business_id = p_business_id and c.rating between 1 and 5) >= 3
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 3), 10));
$function$;

create or replace function public.list_busy_ranges(p_business_id uuid, p_from timestamptz, p_to timestamptz, p_staff_id uuid default null)
returns table(start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path to 'public'
as $function$
  select a.start_at, a.end_at from public.appointments a
   where a.business_id = p_business_id and public.appointment_blocks_slot(a.status)
     and a.start_at < p_to and a.end_at > p_from
     and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
  union all
  select g.start_at, g.end_at from public.google_busy_blocks g
    join public.google_calendar_connections c on c.business_id = g.business_id
   where g.business_id = p_business_id and g.start_at < p_to and g.end_at > p_from
     and case when c.staff_id is not null then p_staff_id is null or c.staff_id = p_staff_id
              else not exists (select 1 from public.staff s where s.business_id = p_business_id and s.active) end
  union all
  select (u.start_date::timestamp at time zone b.timezone), ((u.end_date + 1)::timestamp at time zone b.timezone)
    from public.staff_unavailability u join public.business_profiles b on b.id = u.business_id
   where u.business_id = p_business_id and (p_staff_id is null or u.staff_id = p_staff_id)
     and (u.start_date::timestamp at time zone b.timezone) < p_to
     and ((u.end_date + 1)::timestamp at time zone b.timezone) > p_from;
$function$;

-- list_public_businesses: versiunea v98 (cu specialization, fără filtrul is_private).
create or replace function public.list_public_businesses(p_q text default null, p_city text default null, p_limit integer default 100, p_category text default null)
returns table(id uuid, name text, public_code text, city text, county text, country text, address text,
  latitude double precision, longitude double precision, logo_url text, maps_url text, avg_rating numeric,
  review_count bigint, working_hours jsonb, timezone text, promo_video_url text, category text,
  cover_url text, website_enabled boolean, specialization text)
language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select b.* from public.business_profiles b
     where (p_q is null or length(trim(p_q)) = 0 or b.name ilike '%' || trim(p_q) || '%'
            or b.public_code ilike '%' || trim(p_q) || '%' or coalesce(b.specialization, '') ilike '%' || trim(p_q) || '%')
       and (p_city is null or length(trim(p_city)) = 0 or coalesce(b.city, '') ilike '%' || trim(p_city) || '%'
            or coalesce(b.county, '') ilike '%' || trim(p_city) || '%')
       and (p_category is null or length(trim(p_category)) = 0 or b.category = trim(p_category))
     order by b.name asc
     limit greatest(1, least(coalesce(p_limit, 100), 200))
  )
  select base.id, base.name, base.public_code, base.city, base.county, base.country, base.address,
    base.latitude, base.longitude, base.logo_url, base.maps_url, br.avg_rating, coalesce(br.review_count, 0)::bigint,
    to_jsonb(base.working_hours), base.timezone, base.promo_video_url, base.category, base.cover_url,
    base.website_enabled, base.specialization
  from base left join lateral public.business_rating(base.id) br on true
  order by base.name asc;
$function$;

-- Siguranță: niciun business nu mai e privat după rollback (altfel ar apărea public).
-- Decomentează doar dacă vrei explicit asta:
-- update public.business_profiles set is_private = false where is_private;

commit;
