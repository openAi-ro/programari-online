-- v73: the "soon" reminder goes out ~1 hour before the start (was 30 min), plus a catch-up
-- for late bookings. Only the pg_cron prefilter of job 'send-reminders' changes; the
-- function decides exactly (supabase/functions/send-reminders/windows.ts):
--   approved, reminder_sent = false, start_at in (now+15m, now+65m],
--   confirmation (latest CONFIRMED notification_log row, else created_at) <= now-20m.
-- The prefilter is 1 minute wider on each side. The 24h part is unchanged.

select cron.alter_job(
  (select jobid from cron.job where jobname = 'send-reminders'),
  command := $cmd$
  -- Only call send-reminders when an appointment is due (windows slightly wider than the function's own: soon (15, 65] min with 20 min after confirmation / 23.5-24.5 h).
  select net.http_post(
    url := 'https://tucujqpgshrmljkmqvnl.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1),
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  )
  where exists (
    select 1 from public.appointments a
     where a.status = 'approved' and a.reminder_sent = false
       and a.start_at between now() + interval '14 minutes' and now() + interval '66 minutes'
       and coalesce(
             (select max(l.created_at) from public.notification_log l
               where l.appointment_id = a.id and l.type = 'CONFIRMED'),
             a.created_at) <= now() - interval '19 minutes'
  ) or exists (
    select 1 from public.appointments a
     where a.status = 'approved' and a.reminder_24h_sent = false
       and a.start_at between now() + interval '23 hours 25 minutes' and now() + interval '24 hours 35 minutes'
  );
$cmd$
);
