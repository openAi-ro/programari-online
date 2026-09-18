select prosecdef as security_definer,
       pg_get_function_identity_arguments(oid) as args,
       pg_catalog.pg_get_userbyid(proowner) as owner
from pg_proc
where proname = 'create_appointment_if_free';

select grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and routine_name = 'create_appointment_if_free';

select count(*) as token_count from public.device_push_tokens;

select user_id, platform, updated_at
from public.device_push_tokens
order by updated_at desc
limit 10;

select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'appointments'
order by ordinal_position;
