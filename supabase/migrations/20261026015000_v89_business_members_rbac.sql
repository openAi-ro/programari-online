-- v89: conturi de angajat cu roluri (RBAC) peste business_profiles.
-- Inainte: doar owner_user_id avea acces; angajatii fie nu vedeau nimic, fie foloseau contul proprietarului.
-- Acum: business_members (owner/admin/staff, legatura optionala la un specialist din staff),
-- invitatii pe email cu cod (token) si politici RLS pe membru, nu doar pe proprietar.
-- owner = tot; admin = tot mai putin crearea altui admin si stergerea proprietarului;
-- staff = doar programarile specialistului legat, fara clienti, rapoarte sau setari.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'business_member_role') then
    create type public.business_member_role as enum ('owner', 'admin', 'staff');
  end if;
end $$;

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.business_member_role not null default 'staff',
  staff_id uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create unique index if not exists business_members_staff_unique
  on public.business_members (business_id, staff_id) where staff_id is not null;
create index if not exists business_members_user_idx on public.business_members (user_id);
create index if not exists business_members_business_idx on public.business_members (business_id);

create table if not exists public.business_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  email text not null,
  role public.business_member_role not null default 'staff' check (role in ('admin', 'staff')),
  staff_id uuid references public.staff(id) on delete set null,
  invited_by uuid references public.profiles(id) on delete set null,
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_invitations_business_idx
  on public.business_invitations (business_id, status);
create index if not exists business_invitations_email_idx
  on public.business_invitations (lower(email), status);

-- Proprietarii existenti devin membri owner (fara schimbare de comportament pentru ei).
insert into public.business_members (business_id, user_id, role)
select id, owner_user_id, 'owner' from public.business_profiles
on conflict (business_id, user_id) do nothing;

create or replace function public.handle_new_business_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.business_members (business_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (business_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists business_profiles_owner_member on public.business_profiles;
create trigger business_profiles_owner_member
  after insert on public.business_profiles
  for each row execute function public.handle_new_business_owner_member();

-- Rolul utilizatorului curent intr-un business ('owner' inclusiv pentru proprietarul istoric,
-- chiar daca randul de membru lipseste dintr-un motiv oarecare).
create or replace function public.business_member_role(p_business_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.role::text from public.business_members m
      where m.business_id = p_business_id and m.user_id = auth.uid()),
    (select 'owner' from public.business_profiles b
      where b.id = p_business_id and b.owner_user_id = auth.uid())
  );
$$;

create or replace function public.business_member_staff_id(p_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.staff_id from public.business_members m
  where m.business_id = p_business_id and m.user_id = auth.uid();
$$;

revoke all on function public.business_member_role(uuid) from public, anon;
revoke all on function public.business_member_staff_id(uuid) from public, anon;
grant execute on function public.business_member_role(uuid) to authenticated;
grant execute on function public.business_member_staff_id(uuid) to authenticated;

alter table public.business_members enable row level security;
alter table public.business_invitations enable row level security;

revoke all on table public.business_members from anon;
revoke all on table public.business_invitations from anon;
grant select on table public.business_members to authenticated;
grant select on table public.business_invitations to authenticated;
grant all on table public.business_members to service_role;
grant all on table public.business_invitations to service_role;

-- Membrii isi vad echipa; scrierile trec doar prin RPC-urile de mai jos.
drop policy if exists business_members_select_member on public.business_members;
create policy business_members_select_member on public.business_members
  for select to authenticated
  using (public.business_member_role(business_id) is not null);

drop policy if exists business_invitations_select_manager on public.business_invitations;
create policy business_invitations_select_manager on public.business_invitations
  for select to authenticated
  using (public.business_member_role(business_id) in ('owner', 'admin'));

-- business_profiles: adminul poate edita setarile business-ului (nu doar proprietarul).
drop policy if exists business_update_member_admin on public.business_profiles;
create policy business_update_member_admin on public.business_profiles
  for update to authenticated
  using (public.business_member_role(id) in ('owner', 'admin'))
  with check (public.business_member_role(id) in ('owner', 'admin'));

-- appointments: owner/admin vad tot; staff vede doar programarile specialistului legat de cont.
drop policy if exists appointments_select_member on public.appointments;
create policy appointments_select_member on public.appointments
  for select to authenticated
  using (
    exists (
      select 1 from public.business_members m
      where m.business_id = appointments.business_id
        and m.user_id = auth.uid()
        and (m.role in ('owner', 'admin') or m.staff_id = appointments.staff_id)
    )
  );

drop policy if exists appointments_update_member on public.appointments;
create policy appointments_update_member on public.appointments
  for update to authenticated
  using (
    exists (
      select 1 from public.business_members m
      where m.business_id = appointments.business_id
        and m.user_id = auth.uid()
        and (m.role in ('owner', 'admin') or m.staff_id = appointments.staff_id)
    )
  )
  with check (
    exists (
      select 1 from public.business_members m
      where m.business_id = appointments.business_id
        and m.user_id = auth.uid()
        and (m.role in ('owner', 'admin') or m.staff_id = appointments.staff_id)
    )
  );

-- servicii si echipa: scriere owner/admin (pana acum doar proprietarul).
drop policy if exists services_write_member_admin on public.services;
create policy services_write_member_admin on public.services
  for all to authenticated
  using (public.business_member_role(business_id) in ('owner', 'admin'))
  with check (public.business_member_role(business_id) in ('owner', 'admin'));

drop policy if exists staff_write_member_admin on public.staff;
create policy staff_write_member_admin on public.staff
  for all to authenticated
  using (public.business_member_role(business_id) in ('owner', 'admin'))
  with check (public.business_member_role(business_id) in ('owner', 'admin'));

drop policy if exists staff_private_member_admin on public.staff_private;
create policy staff_private_member_admin on public.staff_private
  for all to authenticated
  using (
    staff_id in (
      select s.id from public.staff s
      where public.business_member_role(s.business_id) in ('owner', 'admin')
    )
  )
  with check (
    staff_id in (
      select s.id from public.staff s
      where public.business_member_role(s.business_id) in ('owner', 'admin')
    )
  );

-- ---------------------------------------------------------------------------
-- RPC: invitatie pe email (cu cod de acceptare, valabil 7 zile)
-- ---------------------------------------------------------------------------
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
  if p_staff_id is not null and not exists (
    select 1 from public.staff s where s.id = p_staff_id and s.business_id = p_business_id
  ) then raise exception 'staff_not_found'; end if;
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

-- Invitatiile in asteptare pentru emailul contului curent (afisate la intrarea in zona business).
create or replace function public.list_my_business_invitations()
returns table (
  invitation_id uuid,
  business_id uuid,
  business_name text,
  role public.business_member_role,
  staff_id uuid,
  token uuid,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.business_id, b.name, i.role, i.staff_id, i.token, i.expires_at
  from public.business_invitations i
  join public.business_profiles b on b.id = i.business_id
  join public.profiles p on p.id = auth.uid()
  where i.status = 'pending'
    and i.expires_at > now()
    and lower(coalesce(p.email, '')) = lower(i.email);
$$;

create or replace function public.list_business_members(p_business_id uuid)
returns table (
  member_id uuid,
  user_id uuid,
  email text,
  display_name text,
  role public.business_member_role,
  staff_id uuid,
  staff_name text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.business_member_role(p_business_id) is null then
    raise exception 'not_business_member';
  end if;
  return query
    select m.id, m.user_id, p.email, p.display_name, m.role, m.staff_id, s.name, m.created_at
    from public.business_members m
    join public.profiles p on p.id = m.user_id
    left join public.staff s on s.id = m.staff_id
    where m.business_id = p_business_id
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
end;
$$;

create or replace function public.list_business_invitations(p_business_id uuid)
returns setof public.business_invitations
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.business_member_role(p_business_id) not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;
  return query
    select * from public.business_invitations
    where business_id = p_business_id and status = 'pending'
    order by created_at desc;
end;
$$;

create or replace function public.update_business_member_role(
  p_member_id uuid,
  p_role public.business_member_role
) returns public.business_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.business_members;
  v_actor text;
  v_row public.business_members;
begin
  select * into v_target from public.business_members where id = p_member_id;
  if not found then raise exception 'member_not_found'; end if;
  v_actor := public.business_member_role(v_target.business_id);
  if v_actor not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  if v_target.role = 'owner' or p_role = 'owner' then raise exception 'cannot_change_owner'; end if;
  if (v_target.role = 'admin' or p_role = 'admin') and v_actor <> 'owner' then
    raise exception 'only_owner_manages_admin';
  end if;
  update public.business_members set role = p_role where id = p_member_id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.remove_business_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.business_members;
  v_actor text;
begin
  select * into v_target from public.business_members where id = p_member_id;
  if not found then raise exception 'member_not_found'; end if;
  v_actor := public.business_member_role(v_target.business_id);
  if v_actor not in ('owner', 'admin') then raise exception 'not_allowed'; end if;
  if v_target.role = 'owner' then raise exception 'cannot_remove_owner'; end if;
  if v_target.role = 'admin' and v_actor <> 'owner' then raise exception 'only_owner_manages_admin'; end if;
  delete from public.business_members where id = p_member_id;
end;
$$;

create or replace function public.revoke_business_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.business_invitations;
begin
  select * into v_inv from public.business_invitations where id = p_invitation_id;
  if not found then raise exception 'invitation_not_found'; end if;
  if public.business_member_role(v_inv.business_id) not in ('owner', 'admin') then
    raise exception 'not_allowed';
  end if;
  update public.business_invitations set status = 'revoked' where id = p_invitation_id;
end;
$$;

-- Cautare clienti existenti pentru walk-in: owner/admin vad toti clientii salonului,
-- staff vede doar clientii cu programari la specialistul legat de cont.
create or replace function public.search_business_clients(
  p_business_id uuid,
  p_query text default ''
)
returns table (
  client_user_id uuid,
  display_name text,
  phone text,
  email text,
  visit_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := public.business_member_role(p_business_id);
  v_staff uuid := public.business_member_staff_id(p_business_id);
  v_q text := lower(trim(coalesce(p_query, '')));
begin
  if v_role is null then raise exception 'not_business_member'; end if;
  return query
    select a.client_user_id,
           max(p.display_name),
           max(a.client_phone),
           max(a.client_email),
           count(*) filter (where a.status = 'approved' and a.start_at < now())
    from public.appointments a
    left join public.profiles p on p.id = a.client_user_id
    where a.business_id = p_business_id
      and (v_role in ('owner', 'admin') or a.staff_id = v_staff)
      and (
        v_q = ''
        or lower(coalesce(p.display_name, '')) like '%' || v_q || '%'
        or lower(coalesce(a.client_email, '')) like '%' || v_q || '%'
        or regexp_replace(coalesce(a.client_phone, ''), '\D', '', 'g')
             like '%' || regexp_replace(v_q, '\D', '', 'g') || '%'
      )
    group by a.client_user_id
    order by max(a.start_at) desc
    limit 50;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC-uri existente rescrise pe membru (nu doar proprietar)
-- ---------------------------------------------------------------------------
-- list_business_clients (corp v57): acces owner/admin, nu staff.
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
  where public.business_member_role(a.business_id) in ('owner', 'admin')
  group by a.business_id, a.client_user_id
  order by max(a.start_at) desc;
$$;

-- business_report (corp v2): acces owner/admin; staff primeste 'not_owner'.
create or replace function public.business_report(p_days int default 30)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_biz uuid;
  v_from timestamptz;
  v_out jsonb;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_days < 1 or p_days > 365 then
    p_days := 30;
  end if;
  v_from := now() - make_interval(days => p_days);

  select m.business_id into v_biz
  from public.business_members m
  where m.user_id = v_user and m.role in ('owner', 'admin')
  order by m.created_at
  limit 1;
  if v_biz is null then
    select id into v_biz from public.business_profiles
    where owner_user_id = v_user order by created_at limit 1;
  end if;
  if v_biz is null then
    raise exception 'not_owner';
  end if;

  select jsonb_build_object(
    'days', p_days,
    'approved', count(*) filter (where a.status = 'approved'),
    'pending', count(*) filter (where a.status = 'pending'),
    'cancelled', count(*) filter (where a.status = 'cancelled'),
    'rejected', count(*) filter (where a.status = 'rejected'),
    'no_show', count(*) filter (where a.no_show),
    'loyalty_redeemed', count(*) filter (where a.loyalty_redeemed),
    'revenue_ron', coalesce(sum(a.service_price) filter (
      where a.status = 'approved' and coalesce(a.no_show, false) = false
    ), 0),
    'deposits_ron', coalesce(sum(a.deposit_ron) filter (where a.payment_status = 'paid'), 0)
  )
  into v_out
  from public.appointments a
  where a.business_id = v_biz
    and a.start_at >= v_from;

  v_out := v_out || jsonb_build_object(
    'top_services', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'name', coalesce(a.service_name, 'Ședință'),
          'count', count(*),
          'revenue_ron', coalesce(sum(a.service_price) filter (
            where a.status = 'approved' and coalesce(a.no_show, false) = false
          ), 0)
        ) as x
        from public.appointments a
        where a.business_id = v_biz and a.start_at >= v_from
        group by coalesce(a.service_name, 'Ședință')
        order by count(*) desc
        limit 5
      ) s
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(x)
      from (
        select jsonb_build_object(
          'name', coalesce(a.staff_name, '—'),
          'approved', count(*) filter (where a.status = 'approved'),
          'no_show', count(*) filter (where a.no_show),
          'revenue_ron', coalesce(sum(a.service_price) filter (
            where a.status = 'approved' and coalesce(a.no_show, false) = false
          ), 0)
        ) as x
        from public.appointments a
        where a.business_id = v_biz and a.start_at >= v_from
        group by coalesce(a.staff_name, '—')
        order by count(*) filter (where a.status = 'approved') desc
      ) s
    ), '[]'::jsonb),
    'avg_rating', (select avg_rating from public.business_rating(v_biz)),
    'review_count', (select review_count from public.business_rating(v_biz))
  );

  return v_out;
end;
$$;

-- business_create_walkin (corp v76): owner/admin liber; staff doar pentru specialistul propriu.
create or replace function public.business_create_walkin(p_business_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_service_id uuid default null::uuid, p_staff_id uuid default null::uuid, p_client_phone text default null::text, p_client_email text default null::text)
 returns appointments
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_staff_id uuid;
  v_staff_name text;
  v_phone text;
  v_email text;
  v_row public.appointments;
  v_role text := public.business_member_role(p_business_id);
  v_my_staff uuid := public.business_member_staff_id(p_business_id);
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
  end if;
  if v_role is null then
    raise exception 'not_business_owner';
  end if;
  if v_role = 'staff' then
    if v_my_staff is null then raise exception 'staff_not_linked'; end if;
    if p_staff_id is not null and p_staff_id <> v_my_staff then
      raise exception 'staff_own_only';
    end if;
    p_staff_id := v_my_staff;
  end if;

  v_phone := nullif(trim(coalesce(p_client_phone, '')), '');
  v_email := nullif(trim(coalesce(p_client_email, '')), '');
  if v_phone is null and v_email is null then
    raise exception 'walkin_contact_required';
  end if;

  if p_staff_id is not null then
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where id = p_staff_id and business_id = p_business_id and active = true;
    if not found then
      raise exception 'staff_not_found';
    end if;
  else
    select id, name into v_staff_id, v_staff_name
    from public.staff
    where business_id = p_business_id and active = true
    order by sort_order, created_at
    limit 1;
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_biz.session_duration_minutes, 30);
  v_end := p_end_at;

  if p_service_id is not null then
    select id, name, duration_minutes, price
    into v_svc_id, v_svc_name, v_svc_duration, v_svc_price
    from public.services
    where id = p_service_id
      and business_id = p_business_id
      and active = true;
    if not found then
      raise exception 'service_not_found';
    end if;
    v_duration := v_svc_duration;
    v_end := p_start_at + make_interval(mins => v_duration);
  end if;

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at < now() - make_interval(mins => 5) then
    raise exception 'too_soon';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform public.assert_slot_free(p_business_id, v_staff_id, p_start_at, v_end, v_buffer);

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status,
    client_email, client_phone,
    service_id, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name,
    decision_notified, reminder_sent, attendance_confirmed
  ) values (
    p_business_id, v_user, p_start_at, v_end, 'approved',
    v_email, v_phone,
    v_svc_id, v_svc_name, v_duration,
    case when v_svc_price is null then null else v_svc_price end,
    'none', 0,
    v_staff_id, v_staff_name,
    true, false, false
  ) returning * into v_row;

  return v_row;
end;
$function$;

-- business_move_appointment (corp v76): owner/admin liber; staff muta doar programarile proprii.
create or replace function public.business_move_appointment(p_appointment_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone)
 returns appointments
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_role text;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row
  from public.appointments a
  where a.id = p_appointment_id;

  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  v_role := public.business_member_role(v_row.business_id);
  if v_role is null
     or (v_role = 'staff' and v_row.staff_id is distinct from public.business_member_staff_id(v_row.business_id)) then
    raise exception 'not_business_owner';
  end if;

  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_move';
  end if;

  if v_row.start_at <= now() then
    raise exception 'cannot_move';
  end if;

  select * into v_biz from public.business_profiles where id = v_row.business_id;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_row.service_duration_minutes, v_biz.session_duration_minutes);
  v_end := p_start_at + make_interval(mins => v_duration);

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at <= now() then
    raise exception 'move_in_past';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

  update public.appointments
  set start_at = p_start_at,
      end_at = v_end,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      updated_at = now()
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.invite_business_member(uuid, text, public.business_member_role, uuid) from public, anon;
revoke all on function public.accept_business_invitation(uuid) from public, anon;
revoke all on function public.list_my_business_invitations() from public, anon;
revoke all on function public.list_business_members(uuid) from public, anon;
revoke all on function public.list_business_invitations(uuid) from public, anon;
revoke all on function public.update_business_member_role(uuid, public.business_member_role) from public, anon;
revoke all on function public.remove_business_member(uuid) from public, anon;
revoke all on function public.revoke_business_invitation(uuid) from public, anon;
revoke all on function public.search_business_clients(uuid, text) from public, anon;
grant execute on function public.invite_business_member(uuid, text, public.business_member_role, uuid) to authenticated;
grant execute on function public.accept_business_invitation(uuid) to authenticated;
grant execute on function public.list_my_business_invitations() to authenticated;
grant execute on function public.list_business_members(uuid) to authenticated;
grant execute on function public.list_business_invitations(uuid) to authenticated;
grant execute on function public.update_business_member_role(uuid, public.business_member_role) to authenticated;
grant execute on function public.remove_business_member(uuid) to authenticated;
grant execute on function public.revoke_business_invitation(uuid) to authenticated;
grant execute on function public.search_business_clients(uuid, text) to authenticated;

notify pgrst, 'reload schema';
