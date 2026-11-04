-- v106: reparatie rezervare ca invitat (eroare gen_random_bytes).
--
-- Cauza: public.guest_ip_hash (v104) apela gen_random_bytes(32) si hmac(...)
-- necalificate, dar functia are SET search_path TO 'public'. Pe Supabase,
-- pgcrypto sta in schema extensions, deci apelul necalificat pica cu:
--   function gen_random_bytes(integer) does not exist (SQLSTATE 42883)
-- iar trimiterea programarii ca invitat esua de fiecare data cand exista
-- antet de IP (apelul normal prin PostgREST).
-- Modelul consacrat in repo e cel din v99: extensions.gen_random_bytes /
-- extensions.digest cu search_path 'public'. Aplicam acelasi model aici.
-- Nu se creeaza tabele noi, nu se schimba limitele sau comportamentul.

create extension if not exists "pgcrypto" with schema extensions;

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
      values (1, encode(extensions.gen_random_bytes(32), 'hex'));
    exception when unique_violation then
      -- alta tranzactie a generat cheia prima; o citim pe aceea
    end;
    select pepper into v_pepper from public.guest_ip_pepper where id = 1;
  end if;
  if v_pepper is null then
    raise exception 'pepper_unavailable';
  end if;
  return encode(extensions.hmac(convert_to(p_ip, 'UTF8'), convert_to(v_pepper, 'UTF8'), 'sha256'), 'hex');
end;
$function$;

revoke all on function public.guest_ip_hash(text) from public, anon, authenticated;
grant execute on function public.guest_ip_hash(text) to service_role;

notify pgrst, 'reload schema';
