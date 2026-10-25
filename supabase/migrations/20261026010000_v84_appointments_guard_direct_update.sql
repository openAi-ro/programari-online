-- Pas 11f: politica appointments_update_owner lasa proprietarul sa schimbe direct (PostgREST)
-- start_at / end_at / staff_id / business_id / status, ocolind assert_slot_free.
-- Garda: pentru apelurile directe (current_user authenticated/anon) ora, specialistul si firma
-- sunt blocate (fluxurile legitime merg prin RPC-urile SECURITY DEFINER business_move_appointment,
-- reschedule_appointment, postpone_appointment_checked, care ruleaza ca owner-ul functiei si verifica
-- slotul); reactivarea (status care nu blocheaza slotul -> pending/approved) trece prin assert_slot_free.
-- Edge functions (service_role) si RPC-urile (postgres) nu sunt afectate.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.assert_reactivation_slot_free(
  p_business_id uuid, p_staff_id uuid, p_start timestamptz, p_end timestamptz, p_exclude_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_buffer integer;
begin
  select coalesce(buffer_minutes, 0) into v_buffer
    from public.business_profiles where id = p_business_id;
  perform public.assert_slot_free(p_business_id, p_staff_id, p_start, p_end, coalesce(v_buffer, 0), p_exclude_id);
end;
$function$;

revoke all on function private.assert_reactivation_slot_free(uuid, uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function private.assert_reactivation_slot_free(uuid, uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;

create or replace function public.appointments_guard_direct_update()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if new.start_at is distinct from old.start_at
       or new.end_at is distinct from old.end_at
       or new.staff_id is distinct from old.staff_id
       or new.business_id is distinct from old.business_id then
      raise exception 'appointment_slot_locked'
        using errcode = '42501',
              hint = 'Use business_move_appointment / reschedule_appointment / postpone_appointment_checked.';
    end if;
    if not public.appointment_blocks_slot(old.status) and public.appointment_blocks_slot(new.status) then
      perform private.assert_reactivation_slot_free(new.business_id, new.staff_id, new.start_at, new.end_at, new.id);
    end if;
  end if;
  return new;
end;
$function$;

revoke all on function public.appointments_guard_direct_update() from public, anon, authenticated;

drop trigger if exists appointments_guard_direct_update on public.appointments;
create trigger appointments_guard_direct_update
  before update on public.appointments
  for each row execute function public.appointments_guard_direct_update();
