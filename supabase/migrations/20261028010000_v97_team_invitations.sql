-- v97: invitatii de echipa utilizabile (aditiv, compatibil cu aplicatia 1.2.0 / 3.00).
-- 1) Angajatul (staff) trebuie legat de un specialist: fara legatura nu vede nicio programare.
-- 2) Invitatia se accepta doar din contul cu emailul invitat (codul singur nu mai ajunge).
-- 3) Trimiterea emailului (edge function send-business-invite) trece prin
--    claim_business_invitation_send: drepturi owner/admin + limita 1 trimitere / minut / invitatie;
--    fiecare retrimitere reinnoieste valabilitatea de 7 zile.
-- 4) list_my_business_invitations: potrivire si pe emailul de autentificare, plus numele specialistului.
-- 5) Paritate admin (rang owner 3 > admin 2 > staff 1): adminul vede recenziile si lista de asteptare
--    a salonului, raspunde la recenzii si scoate clienti din lista de asteptare.

alter table public.business_invitations
  add column if not exists last_sent_at timestamptz,
  add column if not exists send_count integer not null default 0;

-- Emailurile contului curent (profil + autentificare), pentru potrivirea invitatiei.
create or replace function public.current_user_emails()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select array_remove(array[
    (select lower(nullif(trim(p.email), '')) from public.profiles p where p.id = auth.uid()),
    (select lower(nullif(trim(u.email), '')) from auth.users u where u.id = auth.uid())
  ], null);
$$;
revoke all on function public.current_user_emails() from public, anon;
grant execute on function public.current_user_emails() to authenticated;

create or replace function public.invite_business_member(
  p_business_id uuid,
  p_email text,
  p_role public.business_member_role default 'staff',
  p_staff_id uuid default null
) returns public.business_invitations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := public.business_member_role(p_business_id);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_row public.business_invitations;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if v_actor is null then raise exception 'not_business_member'; end if;
  if v_actor not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  if p_role = 'owner' then raise exception 'cannot_invite_owner'; end if;
  if p_role = 'admin' and v_actor <> 'owner' then raise exception 'only_owner_invites_admin'; end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;
  if p_role = 'staff' and p_staff_id is null then raise exception 'staff_required'; end if;
  if p_staff_id is not null and not exists (
    select 1 from public.staff s where s.id = p_staff_id and s.business_id = p_business_id
  ) then raise exception 'staff_not_found'; end if;
  if p_staff_id is not null and exists (
    select 1 from public.business_members m
    where m.business_id = p_business_id and m.staff_id = p_staff_id
  ) then raise exception 'staff_already_linked'; end if;
  if exists (
    select 1 from public.business_members m
    join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id and lower(coalesce(p.email, '')) = v_email
  ) then raise exception 'already_member'; end if;

  update public.business_invitations
     set status = 'revoked'
   where business_id = p_business_id and lower(email) = v_email and status = 'pending';

  insert into public.business_invitations (business_id, email, role, staff_id, invited_by)
  values (p_business_id, v_email, p_role, p_staff_id, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.accept_business_invitation(p_token uuid)
returns public.business_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.business_invitations;
  v_row public.business_members;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from public.business_invitations
   where token = p_token and status = 'pending';
  if not found then raise exception 'invitation_not_found'; end if;
  if v_inv.expires_at < now() then raise exception 'invitation_expired'; end if;
  if not (lower(v_inv.email) = any (public.current_user_emails())) then
    raise exception 'email_mismatch';
  end if;
  if exists (
    select 1 from public.business_members
    where business_id = v_inv.business_id and user_id = v_user
  ) then raise exception 'already_member'; end if;
  if v_inv.staff_id is not null and exists (
    select 1 from public.business_members
    where business_id = v_inv.business_id and staff_id = v_inv.staff_id
  ) then raise exception 'staff_already_linked'; end if;

  insert into public.business_members (business_id, user_id, role, staff_id)
  values (v_inv.business_id, v_user, v_inv.role, v_inv.staff_id)
  returning * into v_row;

  update public.business_invitations
     set status = 'accepted', accepted_by = v_user, accepted_at = now()
   where id = v_inv.id;
  return v_row;
end;
$$;

-- Tipul de retur se schimba (staff_name): drop + create in aceeasi tranzactie.
drop function if exists public.list_my_business_invitations();
create function public.list_my_business_invitations()
returns table (
  invitation_id uuid,
  business_id uuid,
  business_name text,
  role public.business_member_role,
  staff_id uuid,
  token uuid,
  expires_at timestamptz,
  staff_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.business_id, b.name, i.role, i.staff_id, i.token, i.expires_at, s.name
  from public.business_invitations i
  join public.business_profiles b on b.id = i.business_id
  left join public.staff s on s.id = i.staff_id
  where i.status = 'pending'
    and i.expires_at > now()
    and lower(i.email) = any (public.current_user_emails())
    and not exists (
      select 1 from public.business_members m
      where m.business_id = i.business_id and m.user_id = auth.uid()
    )
  order by i.created_at desc;
$$;
revoke all on function public.list_my_business_invitations() from public, anon;
grant execute on function public.list_my_business_invitations() to authenticated;

-- Detaliile unei invitatii dupa cod (linkul din email), pentru contul autentificat.
create or replace function public.get_business_invitation(p_token uuid)
returns table (
  invitation_id uuid,
  business_id uuid,
  business_name text,
  role public.business_member_role,
  staff_name text,
  status text,
  expires_at timestamptz,
  email_matches boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select i.id, i.business_id, b.name, i.role, s.name,
           case when i.status = 'pending' and i.expires_at < now() then 'expired' else i.status end,
           i.expires_at,
           lower(i.email) = any (public.current_user_emails())
    from public.business_invitations i
    join public.business_profiles b on b.id = i.business_id
    left join public.staff s on s.id = i.staff_id
    where i.token = p_token;
end;
$$;
revoke all on function public.get_business_invitation(uuid) from public, anon;
grant execute on function public.get_business_invitation(uuid) to authenticated;

-- Pregatirea unei trimiteri de email: verifica drepturile si limita, apoi intoarce ce trebuie in email.
create or replace function public.claim_business_invitation_send(p_invitation_id uuid)
returns table (
  email text,
  role public.business_member_role,
  token uuid,
  expires_at timestamptz,
  business_name text,
  staff_name text,
  invited_by_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.business_invitations;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from public.business_invitations i where i.id = p_invitation_id for update;
  if not found or v_inv.status <> 'pending' then raise exception 'invitation_not_found'; end if;
  if coalesce(public.business_member_role(v_inv.business_id), '') not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;
  if v_inv.last_sent_at is not null and v_inv.last_sent_at > now() - interval '1 minute' then
    raise exception 'resend_too_soon';
  end if;

  update public.business_invitations i
     set last_sent_at = now(),
         send_count = i.send_count + 1,
         expires_at = greatest(i.expires_at, now() + interval '7 days')
   where i.id = v_inv.id;

  return query
    select i.email, i.role, i.token, i.expires_at, b.name, s.name,
           coalesce(nullif(trim(p.display_name), ''), b.name)
    from public.business_invitations i
    join public.business_profiles b on b.id = i.business_id
    left join public.staff s on s.id = i.staff_id
    left join public.profiles p on p.id = auth.uid()
    where i.id = v_inv.id;
end;
$$;
revoke all on function public.claim_business_invitation_send(uuid) from public, anon;
grant execute on function public.claim_business_invitation_send(uuid) to authenticated;

-- Paritate admin: recenzii si lista de asteptare.
alter policy reviews_select on public.reviews
  using (
    (select auth.uid()) = client_user_id
    or public.business_member_role(business_id) in ('owner', 'admin')
  );

alter policy waitlist_select_own on public.waitlist
  using (
    (select auth.uid()) = client_user_id
    or public.business_member_role(business_id) in ('owner', 'admin')
  );

alter policy waitlist_update_owner on public.waitlist
  using (
    (select auth.uid()) = client_user_id
    or public.business_member_role(business_id) in ('owner', 'admin')
  )
  with check (
    (select auth.uid()) = client_user_id
    or public.business_member_role(business_id) in ('owner', 'admin')
  );

create or replace function public.reply_to_review(p_review_id uuid, p_reply text)
returns public.reviews
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.reviews;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_reply is null or trim(p_reply) = '' then raise exception 'empty_reply'; end if;
  if length(p_reply) > 1000 then raise exception 'reply_too_long'; end if;

  update public.reviews r
  set owner_reply = trim(p_reply), owner_reply_at = now()
  where r.id = p_review_id
    and public.business_member_role(r.business_id) in ('owner', 'admin')
  returning * into v_row;

  if v_row is null then raise exception 'cannot_reply'; end if;
  return v_row;
end;
$function$;

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
      or public.business_member_role(w.business_id) in ('owner', 'admin')
    )
  returning * into v_row;

  if v_row is null then
    raise exception 'cannot_leave';
  end if;

  return v_row;
end;
$function$;

notify pgrst, 'reload schema';
