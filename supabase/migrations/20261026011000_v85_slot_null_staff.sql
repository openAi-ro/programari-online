-- Pas 11g: semantica „fara specialist" (staff_id null) in verificarea slotului.
-- O programare cu staff_id null apare doar cand salonul nu avea specialisti activi (RPC-urile de
-- rezervare/walk-in aleg altfel primul specialist activ), deci reprezinta salonul ca resursa unica:
-- nu stim cine o face, asa ca blocheaza intervalul pentru TOTI specialistii; o rezervare noua fara
-- specialist se ciocneste cu orice programare a salonului. Inainte, cazul mixt nu se ciocnea deloc.
-- Lock-uri: rezervarea fara specialist ia lock exclusiv pe cheia salonului ('-'); rezervarea cu
-- specialist ia lock partajat pe cheia salonului si exclusiv pe cheia specialistului (aceeasi ordine
-- peste tot -> fara deadlock; specialisti diferiti raman concurenti).
-- list_busy_ranges arata la fel ocupat intervalul unei programari fara specialist pentru orice specialist.

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
    end;
$function$;
