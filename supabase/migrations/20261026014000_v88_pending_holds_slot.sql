-- v88: o cerere de programare in asteptare (pending) tine slotul pana la decizie.
--
-- Bug: functia edge expire-pending (cron orar) anula ORICE cerere pending mai veche de 24h,
-- indiferent cand e programarea, fara motiv si fara notificare. Slotul se elibera, iar alt
-- client il putea rezerva; primul client vedea doar "Anulata".
--
-- Acum: pending blocheaza slotul (appointment_blocks_slot, neschimbat) pana cand salonul
-- accepta/respinge, clientul anuleaza, sau expira termenul de raspuns: cu 2h inainte de
-- inceput (pentru cereri facute cu putin timp inainte: minim 30 min dupa creare, cel tarziu
-- la ora de inceput). La expirare: status cancelled, cancel_reason = 'request_expired',
-- clientul si salonul sunt notificati (send-reminders/pendingExpiry.ts).
-- Cron-ul expire-pending se sterge; send-reminders (jobid 1) preia expirarea.

create or replace function public.pending_request_deadline(p_start timestamptz, p_created timestamptz)
returns timestamptz
language sql
immutable
set search_path = public, pg_temp
as $$
  select least(p_start, greatest(p_start - interval '2 hours', p_created + interval '30 minutes'));
$$;

create or replace function public.expire_pending_requests()
returns table(
  r_id uuid,
  r_business_id uuid,
  r_client_user_id uuid,
  r_client_email text,
  r_client_phone text,
  r_start_at timestamptz
)
language sql
set search_path = public, pg_temp
as $$
  with due as (
    select a.id
    from public.appointments a
    where a.status = 'pending'
      and now() >= public.pending_request_deadline(a.start_at, a.created_at)
    for update skip locked
  )
  update public.appointments a
     set status = 'cancelled',
         cancel_reason = 'request_expired',
         updated_at = now()
    from due
   where a.id = due.id
  returning a.id, a.business_id, a.client_user_id, a.client_email, a.client_phone, a.start_at;
$$;
revoke all on function public.pending_request_deadline(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.pending_request_deadline(timestamptz, timestamptz) to service_role;
revoke all on function public.expire_pending_requests() from public, anon, authenticated;
grant execute on function public.expire_pending_requests() to service_role;

do $do$
declare
  v_job bigint;
begin
  if exists (select 1 from cron.job where jobname = 'expire-pending') then
    perform cron.unschedule('expire-pending');
  end if;

  select jobid into v_job from cron.job where jobname = 'send-reminders';
  if v_job is null then
    return;
  end if;
  perform cron.alter_job(
    job_id := v_job,
    command := $cmd$
  -- Only call send-reminders when something is due: reminders (soon (15, 65] min with 20 min after confirmation / 23.5-24.5 h) reschedule requests (v87) or unanswered booking requests (v88) to expire.
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
  ) or exists (
    select 1 from public.appointments a
     where a.requested_start_at is not null
       and (a.status not in ('pending', 'approved')
            or least(a.start_at, a.requested_start_at) <= now() + interval '2 hours')
  ) or exists (
    select 1 from public.appointments a
     where a.status = 'pending'
       and now() >= public.pending_request_deadline(a.start_at, a.created_at)
  );
$cmd$
  );
end;
$do$;
