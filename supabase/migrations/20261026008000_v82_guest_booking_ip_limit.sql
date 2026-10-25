-- v82 (11d.1): limită pe IP pentru programările fără cont.
--
-- De ce în RPC și nu în edge: create_guest_appointment(_multi) sunt apelate de anon direct prin
-- PostgREST (/rest/v1/rpc/...), deci o limită doar în edge s-ar ocoli apelând RPC-ul direct.
-- Garda comună assert_guest_booking_allowed rulează în aceeași tranzacție cu cererea HTTP și
-- vede request.headers.
--
-- IP-ul clientului (verificat pe live, 2026-10-26):
--   * cf-connecting-ip e setat de Cloudflare în fața API-ului; o valoare falsă trimisă de client
--     e respinsă de Cloudflare (403), deci e de încredere;
--   * x-forwarded-for: clientul poate prefixa valori ("9.9.9.9, <ip real>"), deci NU prima intrare;
--     ca rezervă folosim ULTIMA intrare (adăugată de proxy-ul nostru).
-- Se stochează doar sha256(ip), cu sare de scop, nu IP-ul în clar.
--
-- Limite (aceeași eroare guest_rate_limited, deja mapată în client):
--   - max 10 cereri de programare fără cont / oră de pe același IP (toate saloanele)
--   - max 30 / 24h de pe același IP
-- Fără antete (apel intern/service_role) => nu se aplică limita pe IP.
-- Rândul de log se scrie în aceeași tranzacție: dacă programarea eșuează, dispare și log-ul.

create or replace function public.request_client_ip()
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_headers jsonb;
  v_ip text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then
    return null;
  end if;
  v_ip := nullif(trim(v_headers ->> 'cf-connecting-ip'), '');
  if v_ip is null then
    v_ip := nullif(trim(regexp_replace(coalesce(v_headers ->> 'x-forwarded-for', ''), '^.*,', '')), '');
  end if;
  if v_ip is null or char_length(v_ip) > 45 or v_ip !~ '^[0-9A-Fa-f:.]+$' then
    return null;
  end if;
  return lower(v_ip);
end;
$function$;

revoke all on function public.request_client_ip() from public, anon, authenticated;
grant execute on function public.request_client_ip() to service_role;

create table if not exists public.guest_booking_ip_log (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  business_id uuid,
  created_at timestamptz not null default now()
);
alter table public.guest_booking_ip_log enable row level security;
revoke all on table public.guest_booking_ip_log from public, anon, authenticated;
create index if not exists guest_booking_ip_log_ip_created_idx
  on public.guest_booking_ip_log (ip_hash, created_at desc);

create or replace function public.assert_guest_booking_allowed(
  p_business_id uuid,
  p_phone text,
  p_email text,
  p_name text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_phone_key text := public.guest_phone_key(p_phone);
  v_email_key text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_ip text := public.request_client_ip();
  v_ip_hash text;
  v_digits int;
  v_count int;
begin
  if p_name is not null and char_length(p_name) > 80 then
    raise exception 'invalid_name';
  end if;
  if p_phone is not null then
    v_digits := char_length(regexp_replace(p_phone, '\D', '', 'g'));
    if v_digits < 9 or v_digits > 15 or p_phone !~ '^\+?[0-9 ().-]+$' then
      raise exception 'invalid_phone';
    end if;
  end if;
  if v_email_key is not null
     and (char_length(v_email_key) > 254 or v_email_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'invalid_email';
  end if;

  if v_phone_key is not null then
    perform pg_advisory_xact_lock(hashtext('guest_contact:p:' || v_phone_key));
  end if;
  if v_email_key is not null then
    perform pg_advisory_xact_lock(hashtext('guest_contact:e:' || v_email_key));
  end if;
  if v_ip is not null then
    v_ip_hash := encode(sha256(convert_to('guest-booking:' || v_ip, 'UTF8')), 'hex');
    perform pg_advisory_xact_lock(hashtext('guest_ip:' || v_ip_hash));
  end if;
  perform pg_advisory_xact_lock(hashtext('guest_business:' || p_business_id::text));

  if v_ip_hash is not null then
    select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
      into v_digits, v_count
    from public.guest_booking_ip_log
    where ip_hash = v_ip_hash
      and created_at > now() - interval '24 hours';
    if v_digits >= 10 or v_count >= 30 then
      raise exception 'guest_rate_limited';
    end if;
  end if;

  select count(*) into v_count
  from public.appointments
  where business_id = p_business_id
    and status in ('pending', 'approved')
    and start_at > now()
    and (
      (v_phone_key is not null and public.guest_phone_key(client_phone) = v_phone_key)
      or (v_email_key is not null and lower(client_email) = v_email_key)
    );
  if v_count >= 3 then
    raise exception 'too_many_guest';
  end if;

  select count(*) into v_count
  from public.appointments
  where client_user_id is null
    and created_at > now() - interval '24 hours'
    and (
      (v_phone_key is not null and public.guest_phone_key(client_phone) = v_phone_key)
      or (v_email_key is not null and lower(client_email) = v_email_key)
    );
  if v_count >= 5 then
    raise exception 'guest_rate_limited';
  end if;

  select count(*) into v_count
  from public.appointments
  where business_id = p_business_id
    and client_user_id is null
    and created_at > now() - interval '1 hour';
  if v_count >= 10 then
    raise exception 'guest_rate_limited';
  end if;

  if v_ip_hash is not null then
    delete from public.guest_booking_ip_log
     where ip_hash = v_ip_hash and created_at < now() - interval '2 days';
    insert into public.guest_booking_ip_log (ip_hash, business_id) values (v_ip_hash, p_business_id);
  end if;
end;
$function$;

revoke all on function public.assert_guest_booking_allowed(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.assert_guest_booking_allowed(uuid, text, text, text) to service_role;
