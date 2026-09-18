select p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_appointment_if_free',
    'list_busy_ranges',
    'cancel_appointment'
  )
order by 1, 2;

select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'create_appointment_if_free';

select pol.polname,
       pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('appointments', 'device_push_tokens', 'profiles', 'reviews')
order by c.relname, pol.polname;

select
  (select count(*) from public.appointments) as appointments,
  (select count(*) from public.appointments where status = 'pending') as pending,
  (select count(*) from public.appointments where status = 'approved') as approved,
  (select count(*) from public.device_push_tokens) as push_tokens,
  (select count(*) from public.business_profiles) as businesses,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.staff) as staff;

select a.id,
       a.status,
       a.start_at,
       a.created_at,
       a.client_user_id,
       a.business_id,
       (a.client_email is not null) as has_email,
       (a.client_phone is not null) as has_phone
from public.appointments a
order by a.created_at desc
limit 15;
