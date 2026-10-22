-- v68: Google Calendar per specialist.
-- Calendarul conectat aparține unui specialist (staff_id): evenimentele lui blochează
-- doar acel specialist, iar în Google pleacă doar programările lui.
-- staff_id null = firmă fără specialiști (calendarul blochează firma întreagă).

alter table public.google_calendar_connections
  add column if not exists staff_id uuid references public.staff(id) on delete cascade;

-- Un calendar per specialist (pregătit pentru conectări individuale ulterioare).
create unique index if not exists google_calendar_connections_staff_uidx
  on public.google_calendar_connections (staff_id) where staff_id is not null;

alter table public.google_busy_blocks
  add column if not exists staff_id uuid references public.staff(id) on delete cascade;

create index if not exists google_busy_blocks_staff_idx
  on public.google_busy_blocks (staff_id) where staff_id is not null;

update public.google_busy_blocks g
set staff_id = c.staff_id
from public.google_calendar_connections c
where c.business_id = g.business_id
  and g.staff_id is distinct from c.staff_id;

-- Blocările Google se aplică doar specialistului lor (sau firmei, dacă nu au specialist).
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
  where g.business_id = p_business_id
    and g.start_at < p_to
    and g.end_at > p_from
    and (p_staff_id is null or g.staff_id is null or g.staff_id = p_staff_id);
$$;

-- Starea conexiunii include specialistul (tipul de retur se schimbă → drop + create).
drop function if exists public.get_google_calendar_status(uuid);
create function public.get_google_calendar_status(p_business_id uuid)
returns table (
  google_calendar_id text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  status text,
  staff_id uuid
)
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
  return query
  select c.google_calendar_id, c.connected_at, c.last_synced_at, c.status, c.staff_id
  from public.google_calendar_connections c
  where c.business_id = p_business_id;
end;
$$;

revoke all on function public.get_google_calendar_status(uuid) from public, anon;
grant execute on function public.get_google_calendar_status(uuid) to authenticated, service_role;

-- Proprietarul alege al cui e calendarul. Următoarea sincronizare e completă:
-- scoate din Google programările altor specialiști și le trimite pe ale lui.
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
  update public.google_busy_blocks set staff_id = p_staff_id where business_id = p_business_id;
end;
$$;

revoke all on function public.set_google_calendar_staff(uuid, uuid) from public, anon;
grant execute on function public.set_google_calendar_staff(uuid, uuid) to authenticated, service_role;

-- Trigger: doar programările specialistului conectat; cele deja în Google (legate)
-- trec mereu, ca funcția să le poată scoate când se schimbă specialistul.
create or replace function public.appointment_gcal_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments;
begin
  if TG_OP = 'DELETE' then
    if OLD.google_event_id is null then return null; end if;
    v_row := OLD;
  else
    v_row := NEW;
    if TG_OP = 'UPDATE'
       and NEW.status is not distinct from OLD.status
       and NEW.start_at is not distinct from OLD.start_at
       and NEW.end_at is not distinct from OLD.end_at
       and NEW.staff_id is not distinct from OLD.staff_id then
      return null; -- update fără schimbare reală
    end if;
    if NEW.status = 'approved' then
      null; -- creează / mută / scoate (alt specialist)
    elsif NEW.status in ('cancelled', 'rejected')
          and (NEW.google_event_id is not null or (TG_OP = 'UPDATE' and OLD.status = 'approved')) then
      null; -- scoate din Google
    else
      return null; -- pending etc.: nimic de trimis
    end if;
  end if;

  if not exists (
    select 1 from public.google_calendar_connections c
    where c.business_id = v_row.business_id
      and c.status = 'active'
      and (c.staff_id is null or c.staff_id = v_row.staff_id or v_row.google_event_id is not null)
  ) then
    return null;
  end if;

  perform net.http_post(
    url := 'https://tucujqpgshrmljkmqvnl.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_secret' limit 1)
    ),
    body := jsonb_build_object(
      'mode', 'appointment',
      'appointment_id', v_row.id,
      'business_id', v_row.business_id,
      'deleted', TG_OP = 'DELETE',
      'google_event_id', v_row.google_event_id
    ),
    timeout_milliseconds := 10000
  );
  return null;
end;
$$;

drop trigger if exists appointment_gcal_push on public.appointments;
create trigger appointment_gcal_push
  after insert or delete or update of status, start_at, end_at, staff_id on public.appointments
  for each row execute function public.appointment_gcal_push_webhook();

notify pgrst, 'reload schema';
