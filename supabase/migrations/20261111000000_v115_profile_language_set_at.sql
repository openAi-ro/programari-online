-- v115 — limba aleasă explicit se aplică la autentificare pe orice dispozitiv (test încrucișat P6).
-- profiles.language are valoarea implicită 'ro' pentru toate conturile, deci din ea nu se poate
-- ști dacă utilizatorul a ales limba. language_set_at se completează doar când Setări scrie limba
-- (UPDATE ... SET language), inclusiv din versiunea live 3.23; aplicația aplică limba din profil
-- la login doar când language_set_at nu e null.
-- Strict aditiv: coloană nouă nullable, trigger nou, completare doar pe coloana nouă.

alter table public.profiles add column if not exists language_set_at timestamptz;

comment on column public.profiles.language_set_at is
  'Când utilizatorul a ales limba în Setări; null = language e doar valoarea implicită.';

create or replace function public.profiles_mark_language_set()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.language_set_at := now();
  return new;
end;
$$;

revoke all on function public.profiles_mark_language_set() from public, anon, authenticated;

drop trigger if exists profiles_mark_language_set on public.profiles;
create trigger profiles_mark_language_set
  before update of language on public.profiles
  for each row execute function public.profiles_mark_language_set();

-- 'en' diferă de valoarea implicită, deci a fost ales explicit.
update public.profiles
   set language_set_at = now()
 where language = 'en' and language_set_at is null;
