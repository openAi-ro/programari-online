-- v117 — emailurile urmează limba în care clientul vede aplicația până când alege explicit
-- o limbă în Setări (test încrucișat P6 / programari bot F-4: UI în engleză, emailuri în română).
-- La login, aplicația cheamă sync_device_language(limba afișată); funcția scrie limba doar dacă
-- profilul NU are o alegere explicită (language_set_at null) și nu o marchează ca explicită.
-- Strict aditiv: funcție nouă; triggerul din v115 ignoră doar scrierea făcută de această funcție.

create or replace function public.profiles_mark_language_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('programari.language_from_device', true) = 'on' then
    return new;
  end if;
  new.language_set_at := now();
  return new;
end;
$$;

revoke all on function public.profiles_mark_language_set() from public, anon, authenticated;

create or replace function public.sync_device_language(p_lang text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  if p_lang is null or p_lang not in ('ro', 'en') then
    raise exception 'invalid_language';
  end if;
  perform set_config('programari.language_from_device', 'on', true);
  update public.profiles
     set language = p_lang
   where id = auth.uid()
     and language_set_at is null
     and language is distinct from p_lang;
  perform set_config('programari.language_from_device', 'off', true);
end;
$$;

revoke all on function public.sync_device_language(text) from public, anon;
grant execute on function public.sync_device_language(text) to authenticated;
