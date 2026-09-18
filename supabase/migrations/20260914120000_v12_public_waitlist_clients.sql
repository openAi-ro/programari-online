-- v1.2: public booking (anon busy ranges), waitlist, client notes

-- ---------------------------------------------------------------------------
-- Public read of catalog (no PII)
-- ---------------------------------------------------------------------------
grant select on public.business_profiles to anon;
grant select on public.services to anon;

drop policy if exists business_select_anon on public.business_profiles;
create policy business_select_anon on public.business_profiles
  for select to anon using (true);

drop policy if exists services_select_anon on public.services;
create policy services_select_anon on public.services
  for select to anon using (active = true);

-- Busy ranges without client identity (for public slot picker)
create or replace function public.list_busy_ranges(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns table (start_at timestamptz, end_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select a.start_at, a.end_at
  from public.appointments a
  where a.business_id = p_business_id
    and public.appointment_blocks_slot(a.status)
    and a.start_at < p_to
    and a.end_at > p_from;
$$;

revoke all on function public.list_busy_ranges(uuid, timestamptz, timestamptz) from public;
grant execute on function public.list_busy_ranges(uuid, timestamptz, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Client notes (business CRM)
-- ---------------------------------------------------------------------------
create table if not exists public.client_notes (
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (business_id, client_user_id)
);

alter table public.client_notes enable row level security;

drop policy if exists client_notes_owner on public.client_notes;
create policy client_notes_owner on public.client_notes
  for all to authenticated
  using (
    auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  )
  with check (
    auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

grant select, insert, update, delete on public.client_notes to authenticated;

create or replace function public.list_business_clients()
returns table (
  business_id uuid,
  client_user_id uuid,
  contact text,
  display_name text,
  visit_count bigint,
  last_start_at timestamptz,
  upcoming_count bigint,
  note text
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
    count(*) filter (where a.status = 'approved') as visit_count,
    max(a.start_at) filter (
      where a.status = 'approved' and a.start_at < now()
    ) as last_start_at,
    count(*) filter (
      where a.status in ('pending', 'approved') and a.start_at >= now()
    ) as upcoming_count,
    coalesce(max(n.note), '') as note
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  left join public.profiles p on p.id = a.client_user_id
  left join public.client_notes n
    on n.business_id = a.business_id and n.client_user_id = a.client_user_id
  where b.owner_user_id = auth.uid()
  group by a.business_id, a.client_user_id
  order by max(a.start_at) desc;
$$;

revoke all on function public.list_business_clients() from public;
grant execute on function public.list_business_clients() to authenticated;

-- ---------------------------------------------------------------------------
-- Waitlist
-- ---------------------------------------------------------------------------
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  desired_date date not null,
  status text not null default 'active'
    check (status in ('active', 'notified', 'booked', 'cancelled')),
  client_email text,
  client_phone text,
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists waitlist_business_date_idx
  on public.waitlist (business_id, desired_date, status);

create unique index if not exists waitlist_active_unique_idx
  on public.waitlist (
    business_id,
    client_user_id,
    desired_date,
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

alter table public.waitlist enable row level security;

drop policy if exists waitlist_select_own on public.waitlist;
create policy waitlist_select_own on public.waitlist
  for select to authenticated using (
    auth.uid() = client_user_id
    or auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

drop policy if exists waitlist_update_owner on public.waitlist;
create policy waitlist_update_owner on public.waitlist
  for update to authenticated using (
    auth.uid() = client_user_id
    or auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

grant select, update on public.waitlist to authenticated;

create or replace function public.join_waitlist(
  p_business_id uuid,
  p_desired_date date,
  p_service_id uuid default null
) returns public.waitlist
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_row public.waitlist;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if not exists (select 1 from public.business_profiles where id = p_business_id) then
    raise exception 'business_not_found';
  end if;

  select * into v_row
  from public.waitlist
  where business_id = p_business_id
    and client_user_id = v_user
    and desired_date = p_desired_date
    and status = 'active'
    and coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_service_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if found then
    return v_row;
  end if;

  insert into public.waitlist (
    business_id, client_user_id, service_id, desired_date, status, client_email, client_phone
  )
  values (p_business_id, v_user, p_service_id, p_desired_date, 'active', v_email, v_phone)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.join_waitlist(uuid, date, uuid) from public;
grant execute on function public.join_waitlist(uuid, date, uuid) to authenticated;

create or replace function public.leave_waitlist(
  p_waitlist_id uuid
) returns public.waitlist
language plpgsql
security definer
set search_path = public
as $$
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
    and w.status = 'active'
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
$$;

revoke all on function public.leave_waitlist(uuid) from public;
grant execute on function public.leave_waitlist(uuid) to authenticated;
