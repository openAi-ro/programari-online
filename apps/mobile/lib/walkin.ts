import { supabase } from './supabase';
import type { Appointment } from './types';
import { unwrapRpcRow } from './bookingRpc';

export async function createWalkinAppointment(opts: {
  businessId: string;
  startAt: string;
  endAt: string;
  serviceId: string | null;
  staffId: string | null;
  phone: string | null;
  email: string | null;
}): Promise<{ appointment: Appointment | null; error: string | null }> {
  const { data, error } = await supabase.rpc('business_create_walkin', {
    p_business_id: opts.businessId,
    p_start_at: opts.startAt,
    p_end_at: opts.endAt,
    p_service_id: opts.serviceId,
    p_staff_id: opts.staffId,
    p_client_phone: opts.phone,
    p_client_email: opts.email,
  });
  if (error) {
    const text = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
    return { appointment: null, error: text };
  }
  const appointment = unwrapRpcRow<Appointment>(data);
  if (!appointment?.id) {
    return { appointment: null, error: 'booking_empty_result' };
  }
  return { appointment, error: null };
}
