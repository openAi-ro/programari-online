-- v75: blocam scrierile directe (PostgREST, rol authenticated/anon) pe campuri sensibile.
-- Toate fluxurile legitime trec prin functii SECURITY DEFINER (current_user = postgres)
-- sau edge functions cu service_role, deci nu sunt afectate:
--   plati: mark_deposit_paid, waive_deposit, create_*appointment*, business_create_walkin,
--          stripe-webhook / refund-deposit (service_role).
--   waitlist: join_waitlist / leave_waitlist (RPC), notify-waitlist (service_role).
-- Singura scriere directa legitima: markWaitlistBooked (client, active/notified -> booked dupa ce
-- a facut programarea) - permisa doar daca exista programarea clientului in ziua respectiva.
-- Functiile trigger sunt SECURITY INVOKER intentionat (altfel current_user ar fi owner-ul functiei).

-- 1) appointments: payment_status / deposit_ron / service_price nu se mai modifica direct.
create or replace function public.appointments_guard_payment_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (new.payment_status is distinct from old.payment_status
          or new.deposit_ron is distinct from old.deposit_ron
          or new.service_price is distinct from old.service_price) then
    raise exception 'payment_fields_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_guard_payment_fields on public.appointments;
create trigger appointments_guard_payment_fields
  before update on public.appointments
  for each row execute function public.appointments_guard_payment_fields();

-- 2) waitlist: business_id, client_user_id si celelalte campuri sunt fixe; status doar dupa reguli.
create or replace function public.waitlist_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception 'waitlist_field_locked' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    -- proprietarul salonului isi administreaza lista
    if exists (select 1 from public.business_profiles b
               where b.id = old.business_id and b.owner_user_id = auth.uid()) then
      return new;
    end if;
    -- clientul: doar active/notified -> booked, si doar daca are programarea in ziua aceea
    if old.client_user_id = auth.uid()
       and old.status in ('active', 'notified')
       and new.status = 'booked'
       and exists (
         select 1
           from public.appointments a
           join public.business_profiles b on b.id = a.business_id
          where a.business_id = old.business_id
            and a.client_user_id = auth.uid()
            and a.status in ('pending', 'approved')
            and (a.start_at at time zone coalesce(b.timezone, 'Europe/Bucharest'))::date = old.desired_date
       ) then
      return new;
    end if;
    raise exception 'waitlist_status_locked' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists waitlist_guard_update on public.waitlist;
create trigger waitlist_guard_update
  before update on public.waitlist
  for each row execute function public.waitlist_guard_update();

-- Politica de UPDATE primeste si WITH CHECK (randul ramane al aceluiasi client / salon).
alter policy waitlist_update_owner on public.waitlist
  with check (
    (select auth.uid()) = client_user_id
    or (select auth.uid()) in (select b.owner_user_id from public.business_profiles b
                               where b.id = waitlist.business_id)
  );

revoke all on function public.appointments_guard_payment_fields() from public, anon, authenticated;
revoke all on function public.waitlist_guard_update() from public, anon, authenticated;