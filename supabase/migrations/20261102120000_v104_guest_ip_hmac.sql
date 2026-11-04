-- v104 (post-audit F-32): IP-ul invitaților e pseudonimizat cu HMAC și cheie secretă,
-- nu cu sha256 simplu (reversibil prin forță brută pe spațiul IPv4).
--
-- Cheia (pepper) se generează o singură dată, la prima utilizare, și stă într-un tabel
-- citibil doar prin funcția guest_ip_hash (service_role). Nu apare în cod sau în istoric.
-- Rândurile vechi (sha256 simplu) nu se mai potrivesc după aplicare; limita o ia de la zero
-- și rândurile vechi dispar prin curățenia de 2 zile (v94).

create table if not exists public.guest_ip_pepper (
  id smallint primary key default 1,
  pepper text not null,
  created_at timestamptz not null default now(),
  constraint guest_ip_pepper_single_row check (id = 1)
);
alter table public.guest_ip_pepper enable row level security;
revoke all on table public.guest_ip_pepper from public, anon, authenticated;
grant select, insert, update on table public.guest_ip_pepper to service_role;

create or replace function public.guest_ip_hash(p_ip text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pepper text;
begin
  if p_ip is null then
    return null;
  end if;
  select pepper into v_pepper from public.guest_ip_pepper where id = 1;
  if v_pepper is null then
    begin
      insert into public.guest_ip_pepper (id, pepper)
      values (1, encode(gen_random_bytes(32), 'hex'));
    exception when unique_violation then
      -- altă tranzacție a generat cheia prima; o citim pe aceea
    end;
    select pepper into v_pepper from public.guest_ip_pepper where id = 1;
  end if;
  if v_pepper is null then
    raise exception 'pepper_unavailable';
  end if;
  return encode(hmac(convert_to(p_ip, 'UTF8'), convert_to(v_pepper, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

revoke all on function public.guest_ip_hash(text) from public, anon, authenticated;
grant execute on function public.guest_ip_hash(text) to service_role;

-- assert_guest_booking_allowed ca în v82, cu singura schimbare: hash HMAC cu cheie.
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
    v_ip_hash := public.guest_ip_hash('guest-booking:' || v_ip);
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
