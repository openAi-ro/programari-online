-- v112: poza clientului pe cardul din Cereri (business).
-- profiles ramane inchis (RLS neschimbat): businessul primeste DOAR (user_id, avatar_url)
-- pentru clientii care au cel putin o programare la un business unde apelantul e membru.
-- owner/admin: toti clientii businessului; staff: doar clientii programati la specialistul legat de cont.
-- Fara telefon, email, nume sau alte coloane din profiles.

create or replace function public.list_related_client_avatars(
  p_business_ids uuid[],
  p_client_ids uuid[]
)
returns table(user_id uuid, avatar_url text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.avatar_url
    from public.profiles p
   where p.id = any(p_client_ids[1:500])
     and p.avatar_url is not null
     and btrim(p.avatar_url) <> ''
     and exists (
       select 1
         from public.appointments a
        where a.client_user_id = p.id
          and a.business_id = any(p_business_ids[1:20])
          and (
            public.business_member_role(a.business_id) in ('owner', 'admin')
            or (
              public.business_member_role(a.business_id) = 'staff'
              and a.staff_id is not null
              and a.staff_id = public.business_member_staff_id(a.business_id)
            )
          )
     );
$$;

revoke all on function public.list_related_client_avatars(uuid[], uuid[]) from public, anon;
grant execute on function public.list_related_client_avatars(uuid[], uuid[]) to authenticated, service_role;
