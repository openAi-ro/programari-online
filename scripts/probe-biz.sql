select
  (select count(*) from public.device_push_tokens) as push_tokens,
  (select count(*) from public.business_profiles) as businesses,
  (select count(*) from public.staff) as staff,
  (select count(*) from public.services) as services,
  (select count(*) from public.profiles) as profiles;

select b.id, b.public_code, b.owner_user_id, b.min_notice_minutes, b.auto_approve_returning,
       (select count(*) from public.staff s where s.business_id = b.id) as staff_n,
       (select count(*) from public.services s where s.business_id = b.id) as svc_n
from public.business_profiles b;

select user_id, platform, left(expo_push_token, 18) as token_prefix, updated_at
from public.device_push_tokens
order by updated_at desc
limit 20;
