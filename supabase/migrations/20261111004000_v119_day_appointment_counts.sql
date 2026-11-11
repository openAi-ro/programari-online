-- v119 (t282u): numărul de programări pe zi, aceeași sursă pentru calendarul din aplicație
-- (business) și pentru pagina de prezentare /b/<cod> (client, anon).
-- Până acum cifra venea dintr-un select direct pe appointments, pe care RLS îl dă doar
-- proprietarului, deci pagina publică nu avea de unde s-o arate.
-- Întoarce doar ziua (în fusul firmei) și câte programări active încep în ea: fără nume,
-- fără ore, fără id-uri. Orele ocupate sunt oricum publice prin list_busy_ranges.
-- TypeSafe jev-1.14.0 (req-1111-calendar-prezentare): date personale 0,22; Rafael vrea
-- cifra și pentru vizitatori 0,74.
-- Filtrul pe specialist e cel din calendarul business (v85): o programare fără specialist
-- contează la fiecare. p_staff_ids null = toată firma. Cel mult ~2 luni pe cerere.
-- Doar adaugă o funcție: clienții instalați nu sunt afectați. Se aplică ÎNAINTE de publicarea
-- clientului care o folosește, cu OK-ul lui Rafael.

create or replace function public.day_appointment_counts(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff_ids uuid[] default null
)
returns table(day date, appointments integer)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select (a.start_at at time zone b.timezone)::date, count(*)::int
    from public.appointments a
    join public.business_profiles b on b.id = a.business_id
   where a.business_id = p_business_id
     and public.appointment_blocks_slot(a.status)
     and a.start_at >= p_from
     and a.start_at < p_to
     and (p_staff_ids is null or a.staff_id is null or a.staff_id = any(p_staff_ids))
     and p_to - p_from <= interval '62 days'
     and public.business_visible(p_business_id)
   group by 1;
$function$;

revoke all on function public.day_appointment_counts(uuid, timestamptz, timestamptz, uuid[]) from public;
grant execute on function public.day_appointment_counts(uuid, timestamptz, timestamptz, uuid[]) to anon, authenticated, service_role;
