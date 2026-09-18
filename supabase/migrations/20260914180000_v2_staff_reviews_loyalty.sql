-- v2: multi-staff, recenzii, loialitate, rapoarte

-- ---------------------------------------------------------------------------
-- Loyalty setting
-- ---------------------------------------------------------------------------
alter table public.business_profiles
  add column if not exists loyalty_every int not null default 0
    check (loyalty_every between 0 and 50);

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table if not exists public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  name text not null,
  color text not null default '#5B6CFF',
  active boolean not null default true,
  sort_order int not null default 0,
  working_hours jsonb,
  break_hours jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staff_business_idx on public.staff (business_id, active, sort_order);

alter table public.staff enable row level security;

drop policy if exists staff_select_anon on public.staff;
create policy staff_select_anon on public.staff
  for select to anon using (active = true);

drop policy if exists staff_select_authenticated on public.staff;
create policy staff_select_authenticated on public.staff
  for select to authenticated using (
    active = true
    or auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

drop policy if exists staff_write_owner on public.staff;
create policy staff_write_owner on public.staff
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

grant select on public.staff to anon;
grant select, insert, update, delete on public.staff to authenticated;

insert into public.staff (business_id, name, color, sort_order)
select b.id, b.name, '#5B6CFF', 0
from public.business_profiles b
where not exists (select 1 from public.staff s where s.business_id = b.id);

create or replace function public.ensure_default_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.staff (business_id, name, color, sort_order)
  values (new.id, new.name, '#5B6CFF', 0);
  return new;
end;
$$;

drop trigger if exists business_default_staff on public.business_profiles;
create trigger business_default_staff
after insert on public.business_profiles
for each row execute function public.ensure_default_staff();

-- ---------------------------------------------------------------------------
-- Appointments: staff snapshot + loyalty
-- ---------------------------------------------------------------------------
alter table public.appointments
  add column if not exists staff_id uuid references public.staff(id) on delete set null,
  add column if not exists staff_name text,
  add column if not exists loyalty_redeemed boolean not null default false;

create index if not exists appointments_staff_time_idx
  on public.appointments (staff_id, start_at, end_at);

update public.appointments a
set staff_id = s.id,
    staff_name = s.name
from public.staff s
where s.business_id = a.business_id
  and a.staff_id is null
  and s.sort_order = 0;

alter table public.waitlist
  add column if not exists staff_id uuid references public.staff(id) on delete set null;

drop index if exists waitlist_active_unique_idx;
create unique index waitlist_active_unique_idx
  on public.waitlist (
    business_id,
    client_user_id,
    desired_date,
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  rating int not null check (rating between 1 and 5),
  comment text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists reviews_business_idx on public.reviews (business_id, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews
  for select to authenticated using (
    auth.uid() = client_user_id
    or auth.uid() in (
      select owner_user_id from public.business_profiles b where b.id = business_id
    )
  );

grant select on public.reviews to authenticated;

-- ---------------------------------------------------------------------------
-- list_busy_ranges per staff
-- ---------------------------------------------------------------------------
drop function if exists public.list_busy_ranges(uuid, timestamptz, timestamptz);

create or replace function public.list_busy_ranges(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff_id uuid default null
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
    and a.end_at > p_from
    and (p_staff_id is null or a.staff_id = p_staff_id);
$$;

revoke all on function public.list_busy_ranges(uuid, timestamptz, timestamptz, uuid) from public;
grant execute on function public.list_busy_ranges(uuid, timestamptz, timestamptz, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_appointment_if_free: staff + loyalty
-- ---------------------------------------------------------------------------
drop function if exists public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid);

create or replace function public.create_appointment_if_free(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_service_id uuid default null,
  p_staff_id uuid default null
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_row public.appointments;
  v_biz public.business_profiles;
  v_svc_id uuid;
  v_svc_name text;
  v_svc_duration int;
  v_svc_price numeric(10, 2);
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_status text;
  v_deposit numeric(10, 2);
  v_pay text;
  v_staff_id uuid;
  v_staff_name text;
  v_visits bigint;
  v_loyalty boolean := false;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if exists (
    select 1 from public.client_blocks
    where business_id = p_business_id and client_user_id = v_user
  ) then
    raise exception 'client_blocked';
  end if;

  select * into v_biz from public.business_profiles where id = p_business_id;
  if not found then
    raise exception 'business_not_found';
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
    if v_staff_id is null then
      raise exception 'staff_not_found';
    end if;
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := v_biz.session_duration_minutes;
  v_end := p_end_at;
  v_deposit := coalesce(v_biz.deposit_ron, 0);
  v_pay := case when v_deposit > 0 then 'unpaid' else 'none' end;
  v_status := 'pending';

  if coalesce(v_biz.auto_approve_returning, false)
     and exists (
       select 1 from public.appointments
       where business_id = p_business_id
         and client_user_id = v_user
         and status = 'approved'
     )
  then
    v_status := 'approved';
  end if;

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

  select count(*) into v_visits
  from public.appointments
  where business_id = p_business_id
    and client_user_id = v_user
    and status = 'approved'
    and coalesce(no_show, false) = false;

  if coalesce(v_biz.loyalty_every, 0) >= 2
     and ((v_visits + 1) % v_biz.loyalty_every) = 0 then
    v_loyalty := true;
    v_svc_price := 0;
    v_deposit := 0;
    v_pay := 'none';
  end if;

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
    raise exception 'too_soon';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform 1 from public.appointments
  where business_id = p_business_id
    and staff_id is not distinct from v_staff_id
    and public.appointment_blocks_slot(status)
    and start_at < public.busy_end_with_buffer(v_end, v_buffer)
    and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = p_business_id
      and staff_id is not distinct from v_staff_id
      and public.appointment_blocks_slot(status)
      and start_at < public.busy_end_with_buffer(v_end, v_buffer)
      and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status,
    client_email, client_phone,
    service_id, service_name, service_duration_minutes, service_price,
    payment_status, deposit_ron,
    staff_id, staff_name, loyalty_redeemed
  ) values (
    p_business_id, v_user, p_start_at, v_end, v_status,
    v_email, v_phone,
    v_svc_id, v_svc_name, v_svc_duration, v_svc_price,
    v_pay, v_deposit,
    v_staff_id, v_staff_name, v_loyalty
  ) returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid, uuid) from public;
grant execute on function public.create_appointment_if_free(uuid, timestamptz, timestamptz, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule: conflict per staff
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_biz public.business_profiles;
  v_end timestamptz;
  v_duration int;
  v_buffer int;
  v_local_date text;
  v_notice int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_row
  from public.appointments
  where id = p_appointment_id
    and client_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_owner';
  end if;

  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_reschedule';
  end if;

  if v_row.start_at <= now() then
    raise exception 'cannot_reschedule';
  end if;

  select * into v_biz from public.business_profiles where id = v_row.business_id;

  v_notice := coalesce(v_biz.cancel_notice_minutes, 0);
  if v_row.status = 'approved' and v_row.start_at < now() + make_interval(mins => v_notice) then
    raise exception 'too_late';
  end if;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_row.service_duration_minutes, v_biz.session_duration_minutes);
  v_end := p_start_at + make_interval(mins => v_duration);

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at < now() + make_interval(mins => coalesce(v_biz.min_notice_minutes, 0)) then
    raise exception 'too_soon';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform 1 from public.appointments
  where business_id = v_row.business_id
    and id <> p_appointment_id
    and staff_id is not distinct from v_row.staff_id
    and public.appointment_blocks_slot(status)
    and start_at < public.busy_end_with_buffer(v_end, v_buffer)
    and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = v_row.business_id
      and id <> p_appointment_id
      and staff_id is not distinct from v_row.staff_id
      and public.appointment_blocks_slot(status)
      and start_at < public.busy_end_with_buffer(v_end, v_buffer)
      and public.busy_end_with_buffer(end_at, v_buffer) > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

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
$$;

revoke all on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- join_waitlist + staff
-- ---------------------------------------------------------------------------
drop function if exists public.join_waitlist(uuid, date, uuid);

create or replace function public.join_waitlist(
  p_business_id uuid,
  p_desired_date date,
  p_service_id uuid default null,
  p_staff_id uuid default null
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

  if exists (
    select 1 from public.client_blocks
    where business_id = p_business_id and client_user_id = v_user
  ) then
    raise exception 'client_blocked';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if not exists (select 1 from public.business_profiles where id = p_business_id) then
    raise exception 'business_not_found';
  end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff where id = p_staff_id and business_id = p_business_id and active = true
  ) then
    raise exception 'staff_not_found';
  end if;

  select * into v_row
  from public.waitlist
  where business_id = p_business_id
    and client_user_id = v_user
    and desired_date = p_desired_date
    and status = 'active'
    and coalesce(service_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_service_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(staff_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_staff_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if found then
    return v_row;
  end if;

  insert into public.waitlist (
    business_id, client_user_id, service_id, staff_id, desired_date, status, client_email, client_phone
  )
  values (p_business_id, v_user, p_service_id, p_staff_id, p_desired_date, 'active', v_email, v_phone)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.join_waitlist(uuid, date, uuid, uuid) from public;
grant execute on function public.join_waitlist(uuid, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------
create or replace function public.submit_review(
  p_appointment_id uuid,
  p_rating int,
  p_comment text default ''
) returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_apt public.appointments;
  v_row public.reviews;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_rating < 1 or p_rating > 5 then
    raise exception 'invalid_rating';
  end if;

  select * into v_apt from public.appointments
  where id = p_appointment_id and client_user_id = v_user;
  if v_apt.id is null then
    raise exception 'not_owner';
  end if;
  if v_apt.status <> 'approved' or v_apt.end_at > now() or coalesce(v_apt.no_show, false) then
    raise exception 'cannot_review';
  end if;

  insert into public.reviews (
    business_id, appointment_id, client_user_id, staff_id, rating, comment
  ) values (
    v_apt.business_id, v_apt.id, v_user, v_apt.staff_id, p_rating, coalesce(p_comment, '')
  )
  on conflict (appointment_id) do update
    set rating = excluded.rating,
        comment = excluded.comment
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.submit_review(uuid, int, text) from public;
grant execute on function public.submit_review(uuid, int, text) to authenticated;

create or replace function public.business_rating(p_business_id uuid)
returns table (avg_rating numeric, review_count bigint)
language sql
security definer
stable
set search_path = public
as $$
  select round(avg(r.rating)::numeric, 1) as avg_rating,
         count(*)::bigint as review_count
  from public.reviews r
  where r.business_id = p_business_id;
$$;

revoke all on function public.business_rating(uuid) from public;
grant execute on function public.business_rating(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reports (owner, last N days)
-- ---------------------------------------------------------------------------
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

  select id into v_biz from public.business_profiles where owner_user_id = v_user;
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

revoke all on function public.business_report(int) from public;
grant execute on function public.business_report(int) to authenticated;
