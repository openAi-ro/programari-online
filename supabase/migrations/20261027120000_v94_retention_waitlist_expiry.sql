-- v94 (post-audit F-9, F-32) — NOT APPLIED automatically: the jobs change/delete existing rows.
-- Apply only after Rafael approves.
--
-- 1) Waitlist entries for a day that has passed expire (status 'cancelled'), so they no longer
--    count as active anywhere. The app already hides them (desired_date >= today).
-- 2) guest_booking_ip_log keeps only what the rate limit needs (24 h window); older rows are
--    deleted daily instead of only when the same IP books again.

create or replace function public.expire_past_waitlist()
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with done as (
    update public.waitlist
       set status = 'cancelled'
     where status in ('active', 'notified')
       and desired_date < (now() at time zone 'Europe/Bucharest')::date
    returning 1
  )
  select count(*)::integer from done;
$function$;

create or replace function public.prune_guest_booking_ip_log()
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with gone as (
    delete from public.guest_booking_ip_log
     where created_at < now() - interval '2 days'
    returning 1
  )
  select count(*)::integer from gone;
$function$;

revoke all on function public.expire_past_waitlist() from public, anon, authenticated;
revoke all on function public.prune_guest_booking_ip_log() from public, anon, authenticated;

select cron.schedule('expire-past-waitlist', '10 0 * * *', $cron$ select public.expire_past_waitlist(); $cron$);
select cron.schedule('prune-guest-ip-log', '20 3 * * *', $cron$ select public.prune_guest_booking_ip_log(); $cron$);
