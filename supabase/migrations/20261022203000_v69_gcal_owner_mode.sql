-- v69: Google Calendar — modul proprietar vs specialist (înlocuiește regula ambiguă din v68).
-- Titularul calendarului = google_calendar_connections.staff_id:
--   * staff_id setat  → calendarul unui specialist: în Google pleacă doar programările lui,
--                        iar evenimentele Google îi blochează doar lui orele;
--   * staff_id null   → calendarul proprietarului: în Google pleacă toate programările aprobate;
--                        evenimentele Google blochează firma doar dacă firma NU are specialiști
--                        activi (proprietarul lucrează singur); altfel nu blochează pe nimeni.
-- Blocările nu mai copiază staff_id: domeniul vine din conexiune (o singură sursă de adevăr).

comment on column public.google_calendar_connections.staff_id is
  'Titularul calendarului: specialist (blochează/trimite doar pentru el) sau null = proprietar (trimite tot; blochează firma doar fără specialiști activi).';

drop index if exists public.google_busy_blocks_staff_idx;
alter table public.google_busy_blocks drop column if exists staff_id;

create or replace function public.list_busy_ranges(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff_id uuid default null
) returns table (start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select a.start_at, a.end_at
  from public.appointments a
  where a.business_id = p_business_id
    and public.appointment_blocks_slot(a.status)
    and a.start_at < p_to
    and a.end_at > p_from
    and (p_staff_id is null or a.staff_id = p_staff_id)
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
$$;

-- Proprietarul alege titularul: p_staff_id null = proprietar. Următoarea sincronizare e completă.
create or replace function public.set_google_calendar_staff(p_business_id uuid, p_staff_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.business_profiles b
    where b.id = p_business_id and b.owner_user_id = auth.uid()
  ) then
    raise exception 'forbidden';
  end if;
  if p_staff_id is not null and not exists (
    select 1 from public.staff s where s.id = p_staff_id and s.business_id = p_business_id
  ) then
    raise exception 'staff_not_found';
  end if;
  update public.google_calendar_connections
  set staff_id = p_staff_id, full_synced_at = null
  where business_id = p_business_id;
  if not found then
    raise exception 'not_connected';
  end if;
end;
$$;

notify pgrst, 'reload schema';
