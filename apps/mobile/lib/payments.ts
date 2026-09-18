import * as WebBrowser from 'expo-web-browser';

import { getMyAppointmentsUrl } from './bookingLink';
import { supabase } from './supabase';

export async function startDepositCheckout(appointmentId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const success = getMyAppointmentsUrl();
  const { data, error } = await supabase.functions.invoke('create-deposit-checkout', {
    body: {
      appointment_id: appointmentId,
      success_url: success,
      cancel_url: success,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const payload = data as { ok?: boolean; url?: string; error?: string };
  if (payload?.error === 'stripe_not_configured') {
    return { ok: false, error: 'stripe_not_configured' };
  }
  if (!payload?.url) {
    return { ok: false, error: payload?.error ?? 'checkout_failed' };
  }
  await WebBrowser.openBrowserAsync(payload.url);
  return { ok: true };
}

export function mapPayError(error: string): string {
  if (error === 'stripe_not_configured') {
    return 'Plata cu cardul nu e activă încă. Business-ul marchează avansul când îl primește (cash sau transfer).';
  }
  if (error === 'not_payable') {
    return 'Această programare nu mai are un avans de plată.';
  }
  if (error === 'amount_too_small') {
    return 'Avansul minim pentru plata online este 2 lei.';
  }
  return error;
}

export async function invokeRefundDeposit(appointmentId: string): Promise<void> {
  const { error } = await supabase.functions.invoke('refund-deposit', {
    body: { appointment_id: appointmentId },
  });
  if (error) {
    console.warn('refund-deposit failed', error.message);
  }
}
