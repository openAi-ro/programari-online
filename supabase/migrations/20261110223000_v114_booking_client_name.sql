-- v114: numele clientului cu cont ajunge la salon (test încrucișat 10.11.2026, A7 / B F-3 / C F-4).
--
-- Cauza: pentru clienții cu cont, programarea avea doar emailul. Salonul nu poate citi
-- profiles (RLS închis), iar cardul, calendarul și emailurile iau numele din guest_name.
-- La crearea programării copiem numele din profilul clientului în guest_name, doar dacă
-- guest_name e gol (rezervările ca invitat și cele adăugate de salon rămân neschimbate).
-- Numele rămâne cel de la momentul rezervării. Programările existente nu se modifică.

create or replace function public.client_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select left(nullif(btrim(p.display_name), ''), 120)
    from public.profiles p
   where p.id = p_user_id;
$$;

revoke all on function public.client_display_name(uuid) from public, anon, authenticated;
grant execute on function public.client_display_name(uuid) to service_role;

create or replace function public.appointments_fill_client_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_user_id is not null and nullif(btrim(coalesce(new.guest_name, '')), '') is null then
    new.guest_name := public.client_display_name(new.client_user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.appointments_fill_client_name() from public, anon, authenticated;

drop trigger if exists appointments_fill_client_name on public.appointments;
create trigger appointments_fill_client_name
  before insert on public.appointments
  for each row execute function public.appointments_fill_client_name();
