import * as WebBrowser from 'expo-web-browser';

import { getMyAppointmentsUrl } from './bookingLink';
import { supabase } from './supabase';
import { trKey } from './i18n';

export async function startDepositCheckout(
  appointmentId: string,
  tipRon = 0
): Promise<{
  ok: boolean;
  error?: string;
}> {
  const success = getMyAppointmentsUrl();
  const { data, error } = await supabase.functions.invoke('create-deposit-checkout', {
    body: {
      appointment_id: appointmentId,
      success_url: success,
      cancel_url: success,
      tip_ron: tipRon,
    },
  });
  if (error) {
    return { ok: false, error: await functionErrorCode(error) };
  }
  const payload = data as { ok?: boolean; url?: string; error?: string } | null;
  if (!payload?.url) {
    return { ok: false, error: payload?.error ?? 'checkout_failed' };
  }
  await WebBrowser.openBrowserAsync(payload.url);
  return { ok: true };
}

/**
 * La un raspuns non-2xx, supabase-js da un FunctionsHttpError generic
 * ("Edge Function returned a non-2xx status code"); codul real
 * (ex. { error: 'stripe_not_configured' }) e in corpul raspunsului din error.context.
 */
async function functionErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: unknown } | null)?.context as
    | { clone?: () => { json: () => Promise<unknown> }; json?: () => Promise<unknown> }
    | undefined;
  if (context && typeof context.json === 'function') {
    try {
      const res = typeof context.clone === 'function' ? context.clone() : context;
      const body = (await res.json!()) as { error?: unknown } | null;
      if (body && typeof body.error === 'string' && body.error) return body.error;
    } catch {
      // corp lipsa / non-JSON: cadem pe codul generic
    }
  }
  return 'checkout_failed';
}

/** Mesaj clar pentru client; niciodata textul tehnic brut. */
export function mapPayError(error: string): string {
  if (error === 'stripe_not_configured') {
    return trKey('pay.unavailableAfterBook');
  }
  if (error === 'not_payable') {
    return trKey('pay.notPayable');
  }
  if (error === 'amount_too_small') {
    return trKey('pay.minAmount');
  }
  return trKey('pay.genericError');
}

/** Business renunta la avansul neplatit al unei programari (RPC waive_deposit). */
export async function invokeWaiveDeposit(
  appointmentId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc('waive_deposit', { p_appointment_id: appointmentId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function invokeRefundDeposit(
  appointmentId: string
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('refund-deposit', {
    body: { appointment_id: appointmentId },
  });
  if (error) {
    return { ok: false, error: await functionErrorCode(error) };
  }
  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload?.ok === false) {
    return { ok: false, error: payload.error ?? 'refund_failed' };
  }
  return { ok: true };
}
