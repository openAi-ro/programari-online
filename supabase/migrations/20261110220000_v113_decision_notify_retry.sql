-- v113: plasă de siguranță pentru emailul de decizie (aprobat / respins).
--
-- Până acum emailul pleca DOAR din aplicație (Cereri, programare rapidă, auto-aprobare).
-- Dacă apelul către notify-decision eșua (sesiune închisă pe alt dispozitiv → 401, rețea),
-- clientul nu afla niciodată decizia (test încrucișat 10.11.2026: decision_notified=false).
--
-- La 5 minute, pg_cron cere din nou notify-decision pentru deciziile rămase neanunțate.
-- Nu dublează emailul aplicației:
--   * doar după 2 minute de la decizie (apelul aplicației s-a terminat demult);
--   * nu există deja un rând CONFIRMED / REJECTED în notification_log (email trimis);
--   * notify-decision sare singur peste rândurile cu decision_notified=true.
-- Limite: doar programări viitoare, decise în ultima oră și după aplicarea migrării
-- (fără trimiteri retroactive), maximum 20 pe rulare. Programările create de salon cu
-- „Anunță clientul” oprit sunt excluse (notify-decision nu le anunță oricum).

create or replace function public.retry_decision_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select a.id
      from public.appointments a
     where a.status in ('approved', 'rejected')
       and a.decision_notified = false
       and a.updated_at < now() - interval '2 minutes'
       and a.updated_at > greatest(now() - interval '1 hour', timestamptz '2026-11-10 22:00:00+00')
       and a.start_at > now()
       and not (a.created_by is not null and a.notify_client is distinct from true)
       and not exists (
         select 1
           from public.notification_log n
          where n.appointment_id = a.id
            and n.type in ('CONFIRMED', 'REJECTED')
       )
     order by a.updated_at
     limit 20
  loop
    perform net.http_post(
      url := 'https://tucujqpgshrmljkmqvnl.supabase.co/functions/v1/notify-decision',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_secret' limit 1)
      ),
      body := jsonb_build_object('appointment_id', v_id),
      timeout_milliseconds := 10000
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.retry_decision_notifications() from public, anon, authenticated;
grant execute on function public.retry_decision_notifications() to service_role;

select cron.schedule(
  'retry-decision-notifications',
  '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  $cron$ select public.retry_decision_notifications(); $cron$
);
