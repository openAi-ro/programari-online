-- v66: Google Calendar sincronizare automată
-- 1) Programare aprobată / mutată / anulată → trigger → google-calendar-sync (o programare, 1–2 s).
-- 2) pg_cron la 15 minute: citire incrementală (syncToken) din Google, doar dacă există conexiuni active.
-- 3) Starea conexiunii (needs_reconnect la invalid_grant), cache pentru tokenul de acces.
-- Tokenurile rămân accesibile DOAR service role (RLS fără politici, ca în v44).

alter table public.google_calendar_connections
  add column if not exists status text not null default 'active',
  add column if not exists last_error text,
  add column if not exists sync_token text,
  add column if not exists full_synced_at timestamptz,
  add column if not exists access_token text,
  add column if not exists access_token_expires_at timestamptz;

alter table public.google_calendar_connections
  drop constraint if exists google_calendar_connections_status_check;
alter table public.google_calendar_connections
  add constraint google_calendar_connections_status_check
  check (status in ('active', 'needs_reconnect'));

-- Starea pentru ecranul Setări (fără tokenuri), acum și cu status.
drop function if exists public.get_google_calendar_status(uuid);
create function public.get_google_calendar_status(p_business_id uuid)
returns table (google_calendar_id text, connected_at timestamptz, last_synced_at timestamptz, status text)
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
  select c.google_calendar_id, c.connected_at, c.last_synced_at, c.status
  from public.google_calendar_connections c
  where c.business_id = p_business_id;
end;
$$;
revoke all on function public.get_google_calendar_status(uuid) from public, anon;
grant execute on function public.get_google_calendar_status(uuid) to authenticated;

-- Legare în bloc programare → eveniment Google (o singură cerere din funcție).
create or replace function public.gcal_link_events(p_links jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.appointments a
    set google_event_id = l.google_event_id
    from jsonb_to_recordset(p_links) as l(id uuid, google_event_id text)
    where a.id = l.id
    returning 1
  )
  select count(*)::integer from u;
$$;
revoke all on function public.gcal_link_events(jsonb) from public, anon, authenticated;
grant execute on function public.gcal_link_events(jsonb) to service_role;

-- Trigger: trimite spre Google doar ce contează, doar dacă firma are Google conectat.
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
       and NEW.end_at is not distinct from OLD.end_at then
      return null; -- update fără schimbare reală
    end if;
    if NEW.status = 'approved' then
      null; -- creează / mută
    elsif NEW.status in ('cancelled', 'rejected')
          and (NEW.google_event_id is not null or (TG_OP = 'UPDATE' and OLD.status = 'approved')) then
      null; -- scoate din Google
    else
      return null; -- pending etc.: nimic de trimis
    end if;
  end if;

  if not exists (
    select 1 from public.google_calendar_connections c
    where c.business_id = v_row.business_id and c.status = 'active'
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
revoke all on function public.appointment_gcal_push_webhook() from public, anon, authenticated;

drop trigger if exists appointment_gcal_push on public.appointments;
create trigger appointment_gcal_push
  after insert or delete or update of status, start_at, end_at on public.appointments
  for each row execute function public.appointment_gcal_push_webhook();

-- Citire din Google la 15 minute (decalat față de celelalte joburi), doar dacă există conexiuni.
select cron.schedule(
  'google-calendar-sync',
  '7,22,37,52 * * * *',
  $cron$
  select net.http_post(
    url := 'https://tucujqpgshrmljkmqvnl.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1)
    ),
    body := '{"mode":"cron"}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from public.google_calendar_connections where status = 'active');
  $cron$
);

notify pgrst, 'reload schema';
