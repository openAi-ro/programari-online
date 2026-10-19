import { getLanguageSync } from './language';
import { supabase } from './supabase';
import type { Appointment } from './types';

type InvokeResult<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

/** Trigger email/WhatsApp after business approve/reject (fallback dacă webhook-ul lipsește). */
export async function invokeDecisionNotify(
  appointmentId: string
): Promise<InvokeResult> {
  const { data, error } = await supabase.functions.invoke('notify-decision', {
    body: { appointment_id: appointmentId, lang: getLanguageSync() },
  });

  if (error) {
    console.warn('notify-decision invoke failed', error.message);
    return { ok: false, error: error.message };
  }

  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload?.error || payload?.ok === false) {
    return { ok: false, error: payload.error ?? 'decision_notify_failed', data };
  }

  return { ok: true, data };
}

/** Amână programarea cu 1-12h și notifică clientul (WhatsApp/email). */
export async function invokePostpone(
  appointmentId: string,
  hours: number
): Promise<InvokeResult<{ start_at?: string; end_at?: string }>> {
  const { data, error } = await supabase.functions.invoke('notify-postpone', {
    body: { appointment_id: appointmentId, hours, lang: getLanguageSync() },
  });

  if (error) {
    console.warn('notify-postpone invoke failed', error.message);
    return { ok: false, error: error.message };
  }

  const payload = data as {
    ok?: boolean;
    error?: string;
    start_at?: string;
    end_at?: string;
  };

  if (payload?.error || payload?.ok === false) {
    return {
      ok: false,
      error: payload.error ?? 'postpone_failed',
      data: payload,
    };
  }

  return { ok: true, data: payload };
}

/** Trimite mesaj test WhatsApp către telefonul din profil. */
export async function invokeTestWhatsApp(): Promise<
  InvokeResult<{ phone?: string; result?: { stub?: boolean }; hint?: string }>
> {
  const { data, error } = await supabase.functions.invoke('test-whatsapp', {
    body: { lang: getLanguageSync() },
  });

  if (error) {
    const payload = data as { hint?: string; error?: string } | null;
    return {
      ok: false,
      error: payload?.hint || payload?.error || error.message,
      data: payload ?? undefined,
    };
  }

  const payload = data as {
    ok?: boolean;
    error?: string;
    phone?: string;
    result?: { stub?: boolean; ok?: boolean; error?: string };
    hint?: string;
  };

  if (payload?.ok === false || payload?.error) {
    return {
      ok: false,
      error: payload.hint || payload.error || 'whatsapp_send_failed',
      data: payload,
    };
  }

  return { ok: true, data: payload };
}

export type PendingPushResult = {
  sent_push?: number;
  sent_whatsapp?: boolean;
  sent_email?: boolean;
  reason?: string;
};

/**
 * Notifică business-ul despre o cerere pending (push + WhatsApp/email owner).
 * Folosește-o DOAR pentru reprogramări (reason 'rescheduled', UPDATE neacoperit
 * de webhook) sau re-trimitere manuală — la rezervări NOI webhook-ul Database
 * (INSERT) apelează deja funcția; un invoke direct ar produce popup DUBLU.
 */
export async function invokePendingPush(
  appointment: Pick<
    Appointment,
    'id' | 'business_id' | 'status' | 'client_email' | 'client_phone' | 'start_at'
  >,
  opts?: { reason?: 'rescheduled' }
): Promise<InvokeResult<PendingPushResult>> {
  const { data, error } = await supabase.functions.invoke('notify-pending-push', {
    body: {
      record: {
        id: appointment.id,
        business_id: appointment.business_id,
        status: appointment.status ?? 'pending',
        client_email: appointment.client_email,
        client_phone: appointment.client_phone,
        start_at: appointment.start_at,
      },
      id: appointment.id,
      business_id: appointment.business_id,
      status: appointment.status ?? 'pending',
      client_email: appointment.client_email,
      client_phone: appointment.client_phone,
      start_at: appointment.start_at,
      reason: opts?.reason ?? null,
      lang: getLanguageSync(),
    },
  });

  if (error) {
    console.warn('notify-pending-push invoke failed', error.message);
    return { ok: false, error: error.message };
  }

  const pendingPayload = data as (PendingPushResult & { ok?: boolean; error?: string }) | null;
  if (pendingPayload?.error || pendingPayload?.ok === false) {
    return { ok: false, error: pendingPayload.error ?? 'pending_push_failed', data: pendingPayload ?? undefined };
  }

  return { ok: true, data: data as PendingPushResult };
}

/** Notifica clientul ca programarea a fost mutata pe alt slot (dupa business_move_appointment). */
export async function invokeMoved(
  appointmentId: string
): Promise<InvokeResult<{ start_at?: string; end_at?: string }>> {
  const { data, error } = await supabase.functions.invoke('notify-moved', {
    body: { appointment_id: appointmentId, lang: getLanguageSync() },
  });

  if (error) {
    console.warn('notify-moved invoke failed', error.message);
    return { ok: false, error: error.message };
  }

  const payload = data as {
    ok?: boolean;
    error?: string;
    start_at?: string;
    end_at?: string;
  };

  if (payload?.error || payload?.ok === false) {
    return {
      ok: false,
      error: payload.error ?? 'move_notify_failed',
      data: payload,
    };
  }

  return { ok: true, data: payload };
}

export async function markWaitlistBooked(opts: {
  businessId: string;
  clientUserId: string;
  desiredDate: string;
}): Promise<void> {
  const { error } = await supabase
    .from('waitlist')
    .update({ status: 'booked' })
    .eq('business_id', opts.businessId)
    .eq('client_user_id', opts.clientUserId)
    .eq('desired_date', opts.desiredDate)
    .in('status', ['active', 'notified']);
  if (error) {
    console.warn('markWaitlistBooked failed', error.message);
  }
}

export async function invokeWaitlistNotify(opts: {
  business_id: string;
  desired_date: string;
  booking_url: string;
  waitlist_id?: string;
}): Promise<InvokeResult> {
  const { data, error } = await supabase.functions.invoke('notify-waitlist', {
    body: { ...opts, lang: getLanguageSync() },
  });
  if (error) {
    console.warn('notify-waitlist invoke failed', error.message);
    return { ok: false, error: error.message };
  }
  const payload = data as { ok?: boolean; error?: string };
  if (payload?.ok === false || payload?.error) {
    return { ok: false, error: payload.error ?? 'waitlist_notify_failed' };
  }
  return { ok: true, data };
}
