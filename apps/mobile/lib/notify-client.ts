import { supabase } from './supabase';

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
    body: { appointment_id: appointmentId },
  });

  if (error) {
    console.warn('notify-decision invoke failed', error.message);
    return { ok: false, error: error.message };
  }

  return { ok: true, data };
}

/** Trimite mesaj test WhatsApp către telefonul din profil. */
export async function invokeTestWhatsApp(): Promise<
  InvokeResult<{ phone?: string; result?: { stub?: boolean }; hint?: string }>
> {
  const { data, error } = await supabase.functions.invoke('test-whatsapp', {
    body: {},
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as {
    ok?: boolean;
    error?: string;
    phone?: string;
    result?: { stub?: boolean };
    hint?: string;
  };

  if (payload?.error) {
    return { ok: false, error: payload.error, data: payload };
  }

  return { ok: true, data: payload };
}
