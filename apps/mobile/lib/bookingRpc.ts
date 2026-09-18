import { invokeDecisionNotify } from './notify-client';
import { supabase } from './supabase';
import type { Appointment } from './types';

/** PostgREST sometimes returns a composite RPC result as a one-row array. */
export function unwrapRpcRow<T>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    const first = data[0];
    return first == null ? null : (first as T);
  }
  return data as T;
}

/**
 * Ensure a profiles row exists with contact from the auth user.
 * Booking RPC refuses users without email/phone (contact_required).
 */
export async function ensureMyProfile(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, error: 'not_authenticated' };
  }

  const patch: { id: string; email?: string; phone?: string } = { id: user.id };
  if (user.email) patch.email = user.email;
  if (user.phone) patch.phone = user.phone;

  const { error: upErr } = await supabase.from('profiles').upsert(patch, { onConflict: 'id' });
  if (upErr) {
    console.warn('ensureMyProfile upsert failed', upErr.message);
  }
  return { ok: true, userId: user.id };
}

export async function createAppointmentIfFree(opts: {
  businessId: string;
  startAt: string;
  endAt: string;
  serviceId: string | null;
  staffId: string | null;
}): Promise<{ appointment: Appointment | null; error: string | null }> {
  const ensured = await ensureMyProfile();
  if (!ensured.ok) {
    return { appointment: null, error: ensured.error };
  }

  const payload = {
    p_business_id: opts.businessId,
    p_start_at: opts.startAt,
    p_end_at: opts.endAt,
    p_service_id: opts.serviceId || null,
    p_staff_id: opts.staffId || null,
  };

  let { data, error } = await supabase.rpc('create_appointment_if_free', payload);

  if (error && /could not find the function|schema cache/i.test(error.message)) {
    const retry = await supabase.rpc('create_appointment_if_free', {
      p_business_id: opts.businessId,
      p_start_at: opts.startAt,
      p_end_at: opts.endAt,
      p_service_id: opts.serviceId,
    });
    data = retry.data;
    error = retry.error;
  }

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

export async function listBusyRanges(opts: {
  businessId: string;
  fromIso: string;
  toIso: string;
  staffId: string | null;
}): Promise<{ busy: { startUtc: string; endUtc: string }[]; error: string | null }> {
  const { data, error } = await supabase.rpc('list_busy_ranges', {
    p_business_id: opts.businessId,
    p_from: opts.fromIso,
    p_to: opts.toIso,
    p_staff_id: opts.staffId || null,
  });
  if (error) {
    return { busy: [], error: error.message };
  }
  const busy = ((data ?? []) as { start_at: string; end_at: string }[]).map((row) => ({
    startUtc: row.start_at,
    endUtc: row.end_at,
  }));
  return { busy, error: null };
}

export async function notifyAfterBooking(
  appointment: Appointment
): Promise<{ ok: boolean; error?: string }> {
  // NU mai invocăm notify-pending-push de aici: webhook-ul Database
  // (INSERT pe appointments) trimite deja push-ul către business.
  // Apelul direct + webhook = 2 popup-uri la o singură rezervare.
  // Excepție: reprogramările (UPDATE) nu sunt acoperite de webhook și își
  // trimit push-ul separat, cu reason 'rescheduled'.
  if (appointment.status === 'approved') {
    const toClient = await invokeDecisionNotify(appointment.id);
    if (!toClient.ok) {
      console.warn('notify-decision after auto-approve failed', toClient.error);
      return { ok: false, error: toClient.error };
    }
  }
  return { ok: true };
}
