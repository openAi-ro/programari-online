-- v78: limite pentru codurile WhatsApp de autentificare (pasul 9).
-- Max 5 coduri / număr / 24h, 60s între coduri, plus limită pe IP (hash),
-- verificate și rezervate atomic (lock pe număr și pe IP) ca să nu poată fi ocolite în paralel.

alter table public.auth_whatsapp_otps add column if not exists ip_hash text;

create index if not exists auth_whatsapp_otps_phone_created_idx
  on public.auth_whatsapp_otps (phone, created_at desc);
create index if not exists auth_whatsapp_otps_ip_created_idx
  on public.auth_whatsapp_otps (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists auth_whatsapp_otps_created_idx
  on public.auth_whatsapp_otps (created_at);

create or replace function public.auth_whatsapp_otp_reserve(
  p_phone text,
  p_ip_hash text,
  p_code_hash text,
  p_expires_at timestamptz,
  p_cooldown_seconds int,
  p_phone_per_day int,
  p_ip_per_hour int,
  p_ip_per_day int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_last timestamptz;
  v_oldest timestamptz;
  v_n int;
  v_id uuid;
begin
  if p_phone is null or p_phone = '' or p_code_hash is null then
    raise exception 'invalid_input';
  end if;

  -- Ordine fixă (număr, apoi IP): fără deadlock între cereri paralele.
  perform pg_advisory_xact_lock(hashtext('auth_otp:phone:' || p_phone));
  if p_ip_hash is not null then
    perform pg_advisory_xact_lock(hashtext('auth_otp:ip:' || p_ip_hash));
  end if;

  select max(created_at), min(created_at), count(*)
    into v_last, v_oldest, v_n
    from public.auth_whatsapp_otps
   where phone = p_phone
     and created_at > v_now - interval '24 hours';

  if v_last is not null and v_last > v_now - make_interval(secs => p_cooldown_seconds) then
    return jsonb_build_object('ok', false, 'error', 'cooldown',
      'retry_after_s', greatest(1, ceil(extract(epoch from (v_last + make_interval(secs => p_cooldown_seconds) - v_now)))::int));
  end if;
  if v_n >= p_phone_per_day then
    return jsonb_build_object('ok', false, 'error', 'phone_daily_limit',
      'retry_after_s', greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::int));
  end if;

  if p_ip_hash is not null then
    select min(created_at), count(*) into v_oldest, v_n
      from public.auth_whatsapp_otps
     where ip_hash = p_ip_hash and created_at > v_now - interval '1 hour';
    if v_n >= p_ip_per_hour then
      return jsonb_build_object('ok', false, 'error', 'ip_hourly_limit',
        'retry_after_s', greatest(1, ceil(extract(epoch from (v_oldest + interval '1 hour' - v_now)))::int));
    end if;
    select min(created_at), count(*) into v_oldest, v_n
      from public.auth_whatsapp_otps
     where ip_hash = p_ip_hash and created_at > v_now - interval '24 hours';
    if v_n >= p_ip_per_day then
      return jsonb_build_object('ok', false, 'error', 'ip_daily_limit',
        'retry_after_s', greatest(1, ceil(extract(epoch from (v_oldest + interval '24 hours' - v_now)))::int));
    end if;
  end if;

  -- Codurile expiră în 15 minute; rândurile mai vechi de 3 zile nu mai contează pentru limite.
  delete from public.auth_whatsapp_otps where created_at < v_now - interval '3 days';

  insert into public.auth_whatsapp_otps (phone, ip_hash, code_hash, expires_at)
  values (p_phone, p_ip_hash, p_code_hash, p_expires_at)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.auth_whatsapp_otp_reserve(text, text, text, timestamptz, int, int, int, int) from public, anon, authenticated;
grant execute on function public.auth_whatsapp_otp_reserve(text, text, text, timestamptz, int, int, int, int) to service_role;
