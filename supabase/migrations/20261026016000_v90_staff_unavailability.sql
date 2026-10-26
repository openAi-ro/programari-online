-- v90: indisponibilitate per specialist (concedii, zile libere, exceptii).
-- Inainte: blocked_dates exista doar la nivel de salon; un angajat in concediu aparea liber zilnic.
-- Acum: staff_unavailability (interval de date, in fusul salonului), verificat in
-- assert_slot_free (aceeasi functie care verifica suprapunerile), printr-un trigger pe
-- appointments (acopera si caile care nu trec prin assert: serii recurente, guest) si
-- expus in list_busy_ranges, deci sloturile clientilor il respecta automat.

create table if not exists public.staff_unavailability (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint staff_unavailability_range_chk check (end_date >= start_date),
  constraint staff_unavailability_reason_len_chk check (reason is null or char_length(reason) <= 120)
);

create index if not exists staff_unavailability_staff_idx
  on public.staff_unavailability (staff_id, start_date, end_date);
create index if not exists staff_unavailability_business_idx
  on public.staff_unavailability (business_id, start_date);

alter table public.staff_unavailability enable row level security;
revoke all on table public.staff_unavailability from anon;
grant select, insert, update, delete on table public.staff_unavailability to authenticated;
grant all on table public.staff_unavailability to service_role;

-- Citire: orice membru al business-ului. Scriere: owner/admin, sau angajatul pentru propriile zile.
drop policy if exists staff_unavailability_select_member on public.staff_unavailability;
create policy staff_unavailability_select_member on public.staff_unavailability
  for select to authenticated
  using (public.business_member_role(business_id) is not null);

drop policy if exists staff_unavailability_write_manager on public.staff_unavailability;
create policy staff_unavailability_write_manager on public.staff_unavailability
  for all to authenticated
  using (
    public.business_member_role(business_id) in ('owner', 'admin')
    or staff_id = public.business_member_staff_id(business_id)
  )
  with check (
    public.business_member_role(business_id) in ('owner', 'admin')
    or staff_id = public.business_member_staff_id(business_id)
  );

-- Adevarul unic pentru conflict: programarea (in fusul salonului) atinge o zi indisponibila.
create or replace function public.staff_unavailable_conflict(
  p_business_id uuid, p_staff_id uuid, p_start timestamptz, p_end timestamptz
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_staff_id is not null and exists (
    select 1
    from public.staff_unavailability u
    join public.business_profiles b on b.id = u.business_id
    where u.business_id = p_business_id
      and u.staff_id = p_staff_id
      and (timezone(b.timezone, p_start))::date <= u.end_date
      and (timezone(b.timezone, p_end - interval '1 microsecond'))::date >= u.start_date
  );
$$;

revoke all on function public.staff_unavailable_conflict(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.staff_unavailable_conflict(uuid, uuid, timestamptz, timestamptz) to service_role;

-- assert_slot_free: corpul v85 (lock salon + specialist, staff null = resursa unica),
-- plus verificarea de indisponibilitate.
create or replace function public.assert_slot_free(p_business_id uuid, p_staff_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_buffer integer, p_exclude_id uuid default null::uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if p_staff_id is null then
    perform pg_advisory_xact_lock(hashtextextended('slot:' || p_business_id::text || ':-', 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('slot:' || p_business_id::text || ':-', 0));
    perform pg_advisory_xact_lock(hashtextextended('slot:' || p_business_id::text || ':' || p_staff_id::text, 0));
  end if;

  if public.staff_unavailable_conflict(p_business_id, p_staff_id, p_start, p_end) then
    raise exception 'staff_unavailable';
  end if;

  if exists (
    select 1 from public.appointments
     where business_id = p_business_id
       and (p_exclude_id is null or id <> p_exclude_id)
       and (p_staff_id is null or staff_id is null or staff_id = p_staff_id)
       and public.appointment_blocks_slot(status)
       and start_at < public.busy_end_with_buffer(p_end, p_buffer)
       and public.busy_end_with_buffer(end_at, p_buffer) > p_start
  ) or public.has_google_busy_conflict(p_business_id, p_staff_id, p_start, p_end) then
    raise exception 'slot_taken';
  end if;
end;
$function$;

revoke all on function public.assert_slot_free(uuid, uuid, timestamptz, timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.assert_slot_free(uuid, uuid, timestamptz, timestamptz, integer, uuid) to service_role;

-- Trigger pe appointments: acopera orice cale de scriere (inclusiv seriile recurente si
-- update-urile directe permise membrilor), nu doar RPC-urile care cheama assert_slot_free.
create or replace function public.appointments_guard_staff_unavailability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.staff_id is not null
     and public.appointment_blocks_slot(new.status)
     and public.staff_unavailable_conflict(new.business_id, new.staff_id, new.start_at, new.end_at) then
    raise exception 'staff_unavailable';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_guard_staff_unavailability on public.appointments;
create trigger appointments_guard_staff_unavailability
  before insert or update of staff_id, start_at, end_at, status on public.appointments
  for each row execute function public.appointments_guard_staff_unavailability();

-- list_busy_ranges (corp v85) + zilele indisponibile ca intervale ocupate,
-- ca interfata de sloturi a clientilor sa le ascunda fara logica noua.
create or replace function public.list_busy_ranges(p_business_id uuid, p_from timestamp with time zone, p_to timestamp with time zone, p_staff_id uuid default null::uuid)
 returns table(start_at timestamp with time zone, end_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select a.start_at, a.end_at
  from public.appointments a
  where a.business_id = p_business_id
    and public.appointment_blocks_slot(a.status)
    and a.start_at < p_to
    and a.end_at > p_from
    and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
  union all
  select g.start_at, g.end_at
  from public.google_busy_blocks g
  join public.google_calendar_connections c on c.business_id = g.business_id
  where g.business_id = p_business_id
    and g.start_at < p_to
    and g.end_at > p_from
    and case
      when c.staff_id is not null then p_staff_id is null or c.staff_id = p_staff_id
      else not exists (
        select 1 from public.staff s where s.business_id = p_business_id and s.active
      )
    end
  union all
  select (u.start_date::timestamp at time zone b.timezone),
         ((u.end_date + 1)::timestamp at time zone b.timezone)
  from public.staff_unavailability u
  join public.business_profiles b on b.id = u.business_id
  where u.business_id = p_business_id
    and (p_staff_id is null or u.staff_id = p_staff_id)
    and (u.start_date::timestamp at time zone b.timezone) < p_to
    and ((u.end_date + 1)::timestamp at time zone b.timezone) > p_from;
$function$;

notify pgrst, 'reload schema';
