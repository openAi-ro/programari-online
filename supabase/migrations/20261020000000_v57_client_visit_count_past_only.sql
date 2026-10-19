-- v57: fișa / lista de clienți – "vizite" numără doar programările aprobate care au avut loc
-- (start_at < now()). Înainte, o programare aprobată din viitor apărea ca vizită
-- ("1 vizite · ultima —"). Restul funcției e identic cu v13.
create or replace function public.list_business_clients()
returns table (
  business_id uuid,
  client_user_id uuid,
  contact text,
  display_name text,
  visit_count bigint,
  last_start_at timestamptz,
  upcoming_count bigint,
  note text,
  no_show_count bigint,
  blocked boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.business_id,
    a.client_user_id,
    coalesce(
      nullif(max(a.client_phone), ''),
      nullif(max(a.client_email), ''),
      'fără contact'
    ) as contact,
    max(p.display_name) as display_name,
    count(*) filter (
      where a.status = 'approved' and a.start_at < now()
    ) as visit_count,
    max(a.start_at) filter (
      where a.status = 'approved' and a.start_at < now()
    ) as last_start_at,
    count(*) filter (
      where a.status in ('pending', 'approved') and a.start_at >= now()
    ) as upcoming_count,
    coalesce(max(n.note), '') as note,
    count(*) filter (where a.no_show) as no_show_count,
    (max(bl.created_at) is not null) as blocked
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  left join public.profiles p on p.id = a.client_user_id
  left join public.client_notes n
    on n.business_id = a.business_id and n.client_user_id = a.client_user_id
  left join public.client_blocks bl
    on bl.business_id = a.business_id and bl.client_user_id = a.client_user_id
  where b.owner_user_id = auth.uid()
  group by a.business_id, a.client_user_id
  order by max(a.start_at) desc;
$$;
revoke all on function public.list_business_clients() from public;
grant execute on function public.list_business_clients() to authenticated;
notify pgrst, 'reload schema';
