-- v93 (post-audit): additive function fixes, no data changes.
-- F-9: a waitlist entry that was already notified can still be left/removed.
-- F-40: public reviews are returned only once a business has at least 3 reviews.
-- F-17: client check-in is allowed from 60 min before start until the appointment ends.

create or replace function public.leave_waitlist(p_waitlist_id uuid)
returns public.waitlist
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.waitlist;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  update public.waitlist w
  set status = 'cancelled'
  where w.id = p_waitlist_id
    and w.status in ('active', 'notified')
    and (
      w.client_user_id = v_user
      or v_user in (
        select owner_user_id from public.business_profiles b where b.id = w.business_id
      )
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_leave';
  end if;

  return v_row;
end;
$function$;

create or replace function public.list_public_reviews(p_business_id uuid, p_limit integer default 3)
returns table(rating integer, comment text, created_at timestamp with time zone, owner_reply text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    r.rating,
    left(coalesce(r.comment, ''), 160) as comment,
    r.created_at,
    left(coalesce(r.owner_reply, ''), 160) as owner_reply
  from public.reviews r
  where r.business_id = p_business_id
    and r.rating between 1 and 5
    and (
      select count(*) from public.reviews c
      where c.business_id = p_business_id and c.rating between 1 and 5
    ) >= 3
  order by r.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 10));
$function$;

create or replace function public.mark_checked_in(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  update public.appointments
  set checked_in_at = coalesce(checked_in_at, now())
  where id = p_appointment_id
    and client_user_id = v_user
    and status = 'approved'
    and checked_in_at is null
    and now() >= start_at - interval '60 minutes'
    and now() < end_at
  returning * into v_row;

  if not found then
    raise exception 'checkin_not_allowed';
  end if;

  return v_row;
end;
$function$;
