select pol.polname, c.relname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('appointments','device_push_tokens','reviews','staff','services')
order by c.relname, pol.polname;
