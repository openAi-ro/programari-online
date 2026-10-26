-- v87_reschedule: cererea de reprogramare a clientului.
--
-- Salon fara auto-aprobare: clientul nu mai muta direct o programare aprobata; reschedule_appointment
-- salveaza ora propusa in requested_start_at/requested_end_at si salonul decide
-- (business_accept_reschedule / business_decline_reschedule). Ora ceruta e tinuta ocupata
-- (assert_slot_free + list_busy_ranges) pana la decizie sau expirare.
-- Mutare directa ramane cand programarea e inca pending (salonul o aproba oricum) sau cand salonul
-- are auto_approve_returning si clientul are deja o programare aprobata acolo (aceeasi regula ca la rezervare).
-- Expirare: cererea expira cu 2 ore inainte de cea mai devreme dintre ora initiala si ora ceruta
-- (expire_reschedule_requests, apelata de send-reminders; cron-ul send-reminders porneste si pentru ele).
-- Anulare de catre salon cu motiv: business_cancel_appointment (fara rambursari).

alter table public.appointments
  add column if not exists requested_start_at timestamptz,
  add column if not exists requested_end_at timestamptz,
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.appointments
  drop constraint if exists appointments_reschedule_request_chk;
alter table public.appointments
  add constraint appointments_reschedule_request_chk check (
    (requested_start_at is null and requested_end_at is null and reschedule_requested_at is null)
    or (requested_start_at is not null and requested_end_at > requested_start_at and reschedule_requested_at is not null)
  );

alter table public.appointments
  drop constraint if exists appointments_cancel_reason_len_chk;
alter table public.appointments
  add constraint appointments_cancel_reason_len_chk check (cancel_reason is null or char_length(cancel_reason) <= 300);

create index if not exists appointments_requested_start_idx
  on public.appointments (business_id, requested_start_at)
  where requested_start_at is not null;

-- Ora ceruta blocheaza slotul la fel ca ora programarii.
create or replace function public.assert_slot_free(
  p_business_id uuid,
  p_staff_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_buffer integer,
  p_exclude_id uuid default null
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
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
       and (
         (start_at < public.busy_end_with_buffer(p_end, p_buffer)
          and public.busy_end_with_buffer(end_at, p_buffer) > p_start)
         or (requested_start_at is not null
             and requested_start_at < public.busy_end_with_buffer(p_end, p_buffer)
             and public.busy_end_with_buffer(requested_end_at, p_buffer) > p_start)
       )
  ) or public.has_google_busy_conflict(p_business_id, p_staff_id, p_start, p_end) then
    raise exception 'slot_taken';
  end if;
end;
$$;

create or replace function public.list_busy_ranges(
  p_business_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_staff_id uuid default null
)
returns table(start_at timestamptz, end_at timestamptz)
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
    and (p_staff_id is null or a.staff_id is null or a.staff_id = p_staff_id)
  union all
  select a.requested_start_at, a.requested_end_at
  from public.appointments a
  where a.business_id = p_business_id
    and a.requested_start_at is not null
    and public.appointment_blocks_slot(a.status)
    and a.requested_start_at < p_to
    and a.requested_end_at > p_from
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
$$;

-- Cererea si motivul anularii se schimba doar prin RPC-uri.
create or replace function public.appointments_guard_direct_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.start_at is distinct from old.start_at
       or new.end_at is distinct from old.end_at
       or new.staff_id is distinct from old.staff_id
       or new.business_id is distinct from old.business_id
       or new.requested_start_at is distinct from old.requested_start_at
       or new.requested_end_at is distinct from old.requested_end_at
       or new.reschedule_requested_at is distinct from old.reschedule_requested_at
       or new.cancel_reason is distinct from old.cancel_reason then
      raise exception 'appointment_slot_locked'
        using errcode = '42501',
              hint = 'Use business_move_appointment / reschedule_appointment / business_accept_reschedule / business_decline_reschedule / business_cancel_appointment / postpone_appointment_checked.';
    end if;
    if not public.appointment_blocks_slot(old.status) and public.appointment_blocks_slot(new.status) then
      perform private.assert_reactivation_slot_free(new.business_id, new.staff_id, new.start_at, new.end_at, new.id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns public.appointments
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
  v_direct boolean;
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

  v_direct := v_row.status = 'pending'
    or (coalesce(v_biz.auto_approve_returning, false)
        and exists (
          select 1 from public.appointments
          where business_id = v_row.business_id
            and client_user_id = v_user
            and status = 'approved'
        ));

  if not v_direct and least(v_row.start_at, p_start_at) < now() + interval '2 hours' then
    -- cererea ar expira imediat (expire_reschedule_requests)
    raise exception 'too_late';
  end if;

  -- v76: lock pe (salon, specialist) + programari + cereri + Google busy, totul sub lock.
  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

  if v_direct then
    update public.appointments
    set start_at = p_start_at,
        end_at = v_end,
        requested_start_at = null,
        requested_end_at = null,
        reschedule_requested_at = null,
        reminder_sent = false,
        reminder_24h_sent = false,
        attendance_confirmed = false,
        updated_at = now()
    where id = p_appointment_id
    returning * into v_row;
  else
    update public.appointments
    set requested_start_at = p_start_at,
        requested_end_at = v_end,
        reschedule_requested_at = now(),
        updated_at = now()
    where id = p_appointment_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.business_accept_reschedule(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_buffer int;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  where a.id = p_appointment_id
    and b.owner_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;
  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_move';
  end if;
  if v_row.requested_start_at is null then
    raise exception 'no_reschedule_request';
  end if;
  if v_row.requested_start_at <= now() then
    raise exception 'reschedule_expired';
  end if;

  select coalesce(buffer_minutes, 0) into v_buffer
    from public.business_profiles where id = v_row.business_id;

  perform public.assert_slot_free(
    v_row.business_id, v_row.staff_id, v_row.requested_start_at, v_row.requested_end_at,
    coalesce(v_buffer, 0), v_row.id
  );

  update public.appointments
  set start_at = v_row.requested_start_at,
      end_at = v_row.requested_end_at,
      requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      updated_at = now()
  where id = v_row.id
    and requested_start_at = v_row.requested_start_at
    and status in ('pending', 'approved')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'reschedule_changed';
  end if;

  return v_row;
end;
$$;

create or replace function public.business_decline_reschedule(p_appointment_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  where a.id = p_appointment_id
    and b.owner_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  update public.appointments
  set requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      updated_at = now()
  where id = v_row.id
    and requested_start_at is not null
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no_reschedule_request';
  end if;

  return v_row;
end;
$$;

create or replace function public.business_cancel_appointment(p_appointment_id uuid, p_reason text)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.appointments;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if v_reason is null then
    raise exception 'reason_required';
  end if;
  if char_length(v_reason) > 300 then
    raise exception 'reason_too_long';
  end if;

  select a.* into v_row
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  where a.id = p_appointment_id
    and b.owner_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  update public.appointments
  set status = 'cancelled',
      cancel_reason = v_reason,
      requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      updated_at = now()
  where id = v_row.id
    and status in ('pending', 'approved')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'cannot_cancel';
  end if;

  return v_row;
end;
$$;

-- Salonul muta / amana programarea: cererea clientului nu mai are obiect.
create or replace function public.business_move_appointment(p_appointment_id uuid, p_start_at timestamptz, p_end_at timestamptz)
returns public.appointments
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
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select a.* into v_row
  from public.appointments a
  join public.business_profiles b on b.id = a.business_id
  where a.id = p_appointment_id
    and b.owner_user_id = v_user;

  if v_row.id is null then
    raise exception 'not_business_owner';
  end if;

  if v_row.status not in ('pending', 'approved') then
    raise exception 'cannot_move';
  end if;

  if v_row.start_at <= now() then
    raise exception 'cannot_move';
  end if;

  select * into v_biz from public.business_profiles where id = v_row.business_id;

  v_buffer := coalesce(v_biz.buffer_minutes, 0);
  v_duration := coalesce(v_row.service_duration_minutes, v_biz.session_duration_minutes);
  v_end := p_start_at + make_interval(mins => v_duration);

  if v_end <= p_start_at then
    raise exception 'invalid_range';
  end if;

  if p_start_at <= now() then
    raise exception 'move_in_past';
  end if;

  if p_start_at > now() + make_interval(days => coalesce(v_biz.max_advance_days, 90)) then
    raise exception 'too_far';
  end if;

  v_local_date := to_char((timezone(v_biz.timezone, p_start_at))::date, 'YYYY-MM-DD');
  if coalesce(v_biz.blocked_dates, '[]'::jsonb) @> to_jsonb(v_local_date) then
    raise exception 'day_blocked';
  end if;

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, p_start_at, v_end, v_buffer, p_appointment_id);

  update public.appointments
  set start_at = p_start_at,
      end_at = v_end,
      requested_start_at = null,
      requested_end_at = null,
      reschedule_requested_at = null,
      reminder_sent = false,
      reminder_24h_sent = false,
      attendance_confirmed = false,
      updated_at = now()
  where id = p_appointment_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.postpone_appointment_checked(p_appointment_id uuid, p_hours integer)
returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.appointments;
  v_buffer int;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_hours is null or p_hours < 1 or p_hours > 12 then
    raise exception 'invalid_hours';
  end if;

  select * into v_row from public.appointments where id = p_appointment_id for update;
  if v_row.id is null then
    raise exception 'appointment_not_found';
  end if;
  if v_row.status not in ('pending', 'approved') then
    raise exception 'status_not_postponeable';
  end if;

  select coalesce(buffer_minutes, 0) into v_buffer
    from public.business_profiles where id = v_row.business_id;

  v_start := v_row.start_at + make_interval(hours => p_hours);
  v_end := v_row.end_at + make_interval(hours => p_hours);

  perform public.assert_slot_free(v_row.business_id, v_row.staff_id, v_start, v_end, coalesce(v_buffer, 0), v_row.id);

  update public.appointments
     set start_at = v_start,
         end_at = v_end,
         requested_start_at = null,
         requested_end_at = null,
         reschedule_requested_at = null,
         reminder_sent = false,
         reminder_24h_sent = false,
         attendance_confirmed = false,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- Expira cererile cu 2 ore inainte de cea mai devreme dintre ora initiala si ora ceruta;
-- curata si cererile ramase pe programari anulate/terminate. notify_client = programarea e inca activa.
create or replace function public.expire_reschedule_requests()
returns table(
  r_id uuid,
  r_business_id uuid,
  r_client_user_id uuid,
  r_client_email text,
  r_client_phone text,
  r_start_at timestamptz,
  r_requested_start_at timestamptz,
  r_notify_client boolean
)
language sql
set search_path = public, pg_temp
as $$
  with due as (
    select a.id, a.requested_start_at as old_requested
    from public.appointments a
    where a.requested_start_at is not null
      and (
        not public.appointment_blocks_slot(a.status)
        or least(a.start_at, a.requested_start_at) <= now() + interval '2 hours'
      )
    for update skip locked
  )
  update public.appointments a
     set requested_start_at = null,
         requested_end_at = null,
         reschedule_requested_at = null,
         updated_at = now()
    from due
   where a.id = due.id
  returning a.id, a.business_id, a.client_user_id, a.client_email, a.client_phone, a.start_at,
            due.old_requested, public.appointment_blocks_slot(a.status);
$$;

revoke all on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.business_move_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.business_move_appointment(uuid, timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.business_accept_reschedule(uuid) from public, anon;
grant execute on function public.business_accept_reschedule(uuid) to authenticated, service_role;
revoke all on function public.business_decline_reschedule(uuid) from public, anon;
grant execute on function public.business_decline_reschedule(uuid) to authenticated, service_role;
revoke all on function public.business_cancel_appointment(uuid, text) from public, anon;
grant execute on function public.business_cancel_appointment(uuid, text) to authenticated, service_role;
revoke all on function public.expire_reschedule_requests() from public, anon, authenticated;
grant execute on function public.expire_reschedule_requests() to service_role;

-- Cron-ul send-reminders (jobid 1) apeleaza functia doar cand e ceva de facut; acum si pentru
-- cererile de reprogramare care trebuie expirate.
do $do$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'send-reminders';
  if v_job is null then
    return;
  end if;
  perform cron.alter_job(
    job_id := v_job,
    command := $cmd$
  -- Only call send-reminders when something is due: reminders (soon (15, 65] min with 20 min after confirmation / 23.5-24.5 h) or reschedule requests to expire (v87).
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
  );
$cmd$
  );
end;
$do$;
