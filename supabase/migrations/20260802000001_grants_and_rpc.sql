-- Expose tables to Data API roles + secure RPC execute for authenticated clients
grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.business_profiles to authenticated;
grant select, update on public.appointments to authenticated;
grant select, insert, update, delete on public.device_push_tokens to authenticated;

-- RPC: only authenticated can create appointments
grant execute on function public.create_appointment_if_free(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.appointment_blocks_slot(public.appointment_status) to authenticated;

-- Allow reading business by public_code for booking (already covered by SELECT policy for authenticated)
-- No anon booking: app requires login

-- Harden SECURITY DEFINER RPC: revoke public execute, re-grant authenticated only
revoke all on function public.create_appointment_if_free(uuid, timestamptz, timestamptz) from public;
grant execute on function public.create_appointment_if_free(uuid, timestamptz, timestamptz) to authenticated;
