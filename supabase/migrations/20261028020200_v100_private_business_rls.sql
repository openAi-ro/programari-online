-- v100 (3.02): aplicarea modului privat. Un business cu is_private = true e vizibil doar
-- membrilor (owner/admin/staff) și clienților cu acces activ prin cod (business_visible).
-- Rollback: supabase/rollback/v100_rollback.sql

-- 1) Citiri directe (PostgREST, SSR /b, sitemap, embed-uri).
drop policy if exists business_select_anon on public.business_profiles;
create policy business_select_anon on public.business_profiles
  for select to anon using (not is_private);

drop policy if exists business_select_authenticated on public.business_profiles;
create policy business_select_authenticated on public.business_profiles
  for select to authenticated using (not is_private or public.business_visible(id));

drop policy if exists services_select_anon on public.services;
create policy services_select_anon on public.services
  for select to anon using (active = true and public.business_visible(business_id));

drop policy if exists services_select_authenticated on public.services;
create policy services_select_authenticated on public.services
  for select to authenticated using (
    (active = true and public.business_visible(business_id))
    or ((select auth.uid()) in (select b.owner_user_id from public.business_profiles b
                                 where b.id = services.business_id))
  );

drop policy if exists staff_select_anon on public.staff;
create policy staff_select_anon on public.staff
  for select to anon using (active = true and public.business_visible(business_id));

drop policy if exists staff_select_authenticated on public.staff;
create policy staff_select_authenticated on public.staff
  for select to authenticated using (
    (active = true and public.business_visible(business_id))
    or ((select auth.uid()) in (select b.owner_user_id from public.business_profiles b
                                 where b.id = staff.business_id))
  );
-- staff_services_public_read filtrează prin subquery pe staff → urmează automat.

-- 2) Descoperire: business-urile private nu apar niciodată în listă/căutare/hartă.
create or replace function public.list_public_businesses(
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
     where not b.is_private
       and (
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

-- 3) RPC-uri de citire publice (security definer → ocolesc RLS → gardă explicită).
create or replace function public.business_rating(p_business_id uuid)
returns table(avg_rating numeric, review_count bigint)
language sql
stable security definer
set search_path to 'public'
as $function$
  select round(avg(r.rating)::numeric, 1), count(*)::bigint
    from public.reviews r
   where r.business_id = p_business_id
     and public.business_visible(p_business_id);
$function$;

create or replace function public.get_public_staff_phones(p_business_id uuid)
returns table(staff_id uuid, phone text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select sp.staff_id, sp.phone
    from public.staff_private sp
    join public.staff s on s.id = sp.staff_id
   where s.business_id = p_business_id
     and s.active = true
     and sp.phone_public = true
     and sp.phone is not null
     and length(trim(sp.phone)) > 0
     and public.business_visible(p_business_id);
$function$;

create or replace function public.list_public_reviews(p_business_id uuid, p_limit integer default 3)
returns table(rating integer, comment text, created_at timestamptz, owner_reply text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select r.rating, left(coalesce(r.comment, ''), 160), r.created_at,
         left(coalesce(r.owner_reply, ''), 160)
    from public.reviews r
   where r.business_id = p_business_id
     and r.rating between 1 and 5
     and public.business_visible(p_business_id)
     and (select count(*) from public.reviews c
           where c.business_id = p_business_id and c.rating between 1 and 5) >= 3
   order by r.created_at desc
   limit greatest(1, least(coalesce(p_limit, 3), 10));
$function$;

create or replace function public.list_busy_ranges(
  p_business_id uuid, p_from timestamptz, p_to timestamptz, p_staff_id uuid default null
)
returns table(start_at timestamptz, end_at timestamptz)
language sql
stable security definer
set search_path to 'public'
as $function$
  select x.start_at, x.end_at
    from (
      select a.start_at, a.end_at
        from public.appointments a
       where a.business_id = p_business_id
         and public.appointment_blocks_slot(a.status)
         and a.start_at < p_to
         and a.end_at > p_from
         and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
      union all
      select g.start_at, g.end_at
        from public.google_busy_blocks g
        join public.google_calendar_connections c on c.business_id = g.business_id
       where g.business_id = p_business_id
         and g.start_at < p_to
         and g.end_at > p_from
         and case
               when c.staff_id is not null then p_staff_id is null or c.staff_id = p_staff_id
               else not exists (select 1 from public.staff s
                                 where s.business_id = p_business_id and s.active)
             end
      union all
      select (u.start_date::timestamp at time zone b.timezone),
             ((u.end_date + 1)::timestamp at time zone b.timezone)
        from public.staff_unavailability u
        join public.business_profiles b on b.id = u.business_id
       where u.business_id = p_business_id
         and (p_staff_id is null or u.staff_id = p_staff_id)
         and (u.start_date::timestamp at time zone b.timezone) < p_to
         and ((u.end_date + 1)::timestamp at time zone b.timezone) > p_from
    ) x
   where public.business_visible(p_business_id);
$function$;

-- 4) Scrieri: o singură gardă pentru toate căile de creare (programări simple/multi/
-- recurente/guest, listă de așteptare, chat). service_role / cron (fără JWT) trec.
create or replace function public.enforce_private_business_access()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and exists (select 1 from public.business_profiles b
                  where b.id = new.business_id and b.is_private)
     and not public.business_visible(new.business_id) then
    raise exception 'business_private' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_private_business_access() from public, anon, authenticated;

drop trigger if exists appointments_private_business_guard on public.appointments;
create trigger appointments_private_business_guard
  before insert on public.appointments
  for each row execute function public.enforce_private_business_access();

drop trigger if exists waitlist_private_business_guard on public.waitlist;
create trigger waitlist_private_business_guard
  before insert on public.waitlist
  for each row execute function public.enforce_private_business_access();

drop trigger if exists chat_conversations_private_business_guard on public.chat_conversations;
create trigger chat_conversations_private_business_guard
  before insert on public.chat_conversations
  for each row execute function public.enforce_private_business_access();
