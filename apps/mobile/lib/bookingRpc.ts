import { invokeDecisionNotify } from './notify-client';
import { getCurrentUser } from './currentUser';
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
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: 'not_authenticated' };
  }

  // Nu folosim upsert parțial: pe unele setup-uri PostgREST poate atinge coloane
  // omise. Citim profilul și scriem doar ce lipsește — nu ștergem phone salvat în Setări.
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email, phone')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) {
    const { error: insErr } = await supabase.from('profiles').insert({
      id: user.id,
      email: user.email ?? null,
      phone: user.phone ?? null,
    });
    if (insErr) {
      console.warn('ensureMyProfile insert failed', insErr.message);
    }
    return { ok: true, userId: user.id };
  }

  const patch: { email?: string | null; phone?: string | null } = {};
  if (!existing.email && user.email) patch.email = user.email;
  if (!existing.phone && user.phone) patch.phone = user.phone;
  if (Object.keys(patch).length > 0) {
    const { error: upErr } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', user.id);
    if (upErr) {
      console.warn('ensureMyProfile update failed', upErr.message);
    }
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

/** Rezervare cu mai multe servicii (bloc combinat, v41). */
export async function createAppointmentMultiIfFree(opts: {
  businessId: string;
  startAt: string;
  endAt: string;
  serviceIds: string[];
  staffId: string | null;
}): Promise<{ appointment: Appointment | null; error: string | null }> {
  const ensured = await ensureMyProfile();
  if (!ensured.ok) {
    return { appointment: null, error: ensured.error };
  }
  const { data, error } = await supabase.rpc('create_appointment_multi_if_free', {
    p_business_id: opts.businessId,
    p_start_at: opts.startAt,
    p_service_ids: opts.serviceIds,
    p_staff_id: opts.staffId || null,
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

/** Serie saptamanala cu bloc combinat (v41). */
export async function createRecurringMultiAppointments(opts: {
  businessId: string;
  startAt: string;
  endAt: string;
  serviceIds: string[];
  staffId: string | null;
  repeatCount: number;
}): Promise<{ appointments: Appointment[]; error: string | null }> {
  const ensured = await ensureMyProfile();
  if (!ensured.ok) {
    return { appointments: [], error: ensured.error };
  }
  const { data, error } = await supabase.rpc('create_recurring_multi_appointments', {
    p_business_id: opts.businessId,
    p_start_at: opts.startAt,
    p_service_ids: opts.serviceIds,
    p_staff_id: opts.staffId || null,
    p_repeat_count: opts.repeatCount,
  });
  if (error) {
    const text = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
    return { appointments: [], error: text };
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Appointment[];
  if (rows.length === 0 || !rows[0]?.id) {
    return { appointments: [], error: 'booking_empty_result' };
  }
  return { appointments: rows, error: null };
}

/** Rezervare ca invitat (fara cont) — apelabil si anonim (v35). */
export async function createGuestAppointment(opts: {
  businessId: string;
  startAt: string;
  endAt: string;
  serviceId: string | null;
  staffId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
}): Promise<{ appointment: Appointment | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_guest_appointment', {
    p_business_id: opts.businessId,
    p_start_at: opts.startAt,
    p_end_at: opts.endAt,
    p_service_id: opts.serviceId,
    p_staff_id: opts.staffId,
    p_client_name: opts.name,
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

/** Serie saptamanala atomica 2..8 sedinte (v36). Intoarce randurile create. */
export async function createRecurringAppointments(opts: {
  businessId: string;
  startAt: string;
  endAt: string;
  serviceId: string | null;
  staffId: string | null;
  repeatCount: number;
}): Promise<{ appointments: Appointment[]; error: string | null }> {
  const ensured = await ensureMyProfile();
  if (!ensured.ok) {
    return { appointments: [], error: ensured.error };
  }
  const { data, error } = await supabase.rpc('create_recurring_appointments', {
    p_business_id: opts.businessId,
    p_start_at: opts.startAt,
    p_end_at: opts.endAt,
    p_service_id: opts.serviceId,
    p_staff_id: opts.staffId,
    p_repeat_count: opts.repeatCount,
  });
  if (error) {
    const text = [error.message, error.details, error.hint].filter(Boolean).join(' — ');
    return { appointments: [], error: text };
  }
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Appointment[];
  if (rows.length === 0 || !rows[0]?.id) {
    return { appointments: [], error: 'booking_empty_result' };
  }
  return { appointments: rows, error: null };
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

/** Muta o programare pe alt slot — doar owner-ul business-ului (v34). */
export async function moveAppointmentToSlot(opts: {
  appointmentId: string;
  startAt: string;
  endAt: string;
}): Promise<{ appointment: Appointment | null; error: string | null }> {
  const { data, error } = await supabase.rpc('business_move_appointment', {
    p_appointment_id: opts.appointmentId,
    p_start_at: opts.startAt,
    p_end_at: opts.endAt,
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
