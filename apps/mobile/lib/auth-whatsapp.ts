import type { User } from '@supabase/supabase-js';

import { normalizePhoneE164 } from './phone';
import { supabase } from './supabase';

export type WhatsAppOtpRequestResult = {
  ok: true;
  stub?: boolean;
};

export type WhatsAppOtpSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type?: string;
  user: User;
};

function functionsErrorMessage(error: unknown, fallback: string): string {
  if (!error) return fallback;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim()) return m;
  }
  return fallback;
}

/**
 * Request a WhatsApp OTP via Edge Function `auth-whatsapp-otp`.
 * Does not reveal whether the phone already has an account.
 */
export async function requestWhatsAppOtp(phoneRaw: string): Promise<{
  data: WhatsAppOtpRequestResult | null;
  error: string | null;
}> {
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) {
    return {
      data: null,
      error: 'Folosește un număr valid (07xxxxxxxx sau +40...).',
    };
  }

  const { data, error } = await supabase.functions.invoke('auth-whatsapp-otp', {
    body: { phone },
  });

  if (error) {
    // functions.invoke may put JSON body on error.context
    let hint: string | undefined;
    try {
      const ctx = error as { context?: Response };
      if (ctx.context && typeof ctx.context.json === 'function') {
        const body = await ctx.context.json();
        hint = body?.hint ?? body?.error;
      }
    } catch {
      // ignore parse errors
    }
    return {
      data: null,
      error: hint || functionsErrorMessage(error, 'Nu am putut trimite codul.'),
    };
  }

  if (data?.error) {
    return {
      data: null,
      error: data.hint || data.error || 'Nu am putut trimite codul.',
    };
  }

  return {
    data: { ok: true, stub: data?.stub === true ? true : undefined },
    error: null,
  };
}

/**
 * Verify WhatsApp OTP via Edge Function `auth-whatsapp-verify`.
 * On success returns session tokens — call `supabase.auth.setSession` with them.
 */
export async function verifyWhatsAppOtp(
  phoneRaw: string,
  codeRaw: string
): Promise<{
  data: WhatsAppOtpSession | null;
  error: string | null;
}> {
  const phone = normalizePhoneE164(phoneRaw);
  const code = codeRaw.trim();
  if (!phone) {
    return {
      data: null,
      error: 'Folosește un număr valid (07xxxxxxxx sau +40...).',
    };
  }
  if (!/^\d{6}$/.test(code)) {
    return { data: null, error: 'Codul trebuie să aibă 6 cifre.' };
  }

  const { data, error } = await supabase.functions.invoke(
    'auth-whatsapp-verify',
    {
      body: { phone, code },
    }
  );

  if (error) {
    let hint: string | undefined;
    try {
      const ctx = error as { context?: Response };
      if (ctx.context && typeof ctx.context.json === 'function') {
        const body = await ctx.context.json();
        hint = body?.hint ?? body?.error;
      }
    } catch {
      // ignore
    }
    return {
      data: null,
      error: hint || functionsErrorMessage(error, 'Verificare eșuată.'),
    };
  }

  if (data?.error || !data?.access_token || !data?.refresh_token) {
    return {
      data: null,
      error: data?.hint || data?.error || 'Verificare eșuată.',
    };
  }

  return {
    data: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      expires_at: data.expires_at,
      token_type: data.token_type,
      user: data.user,
    },
    error: null,
  };
}

/**
 * Apply WhatsApp OTP session on the mobile Supabase client.
 * Example:
 *   const { data, error } = await verifyWhatsAppOtp(phone, code);
 *   if (data) await applyWhatsAppOtpSession(data);
 */
export async function applyWhatsAppOtpSession(session: {
  access_token: string;
  refresh_token: string;
}) {
  return supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
}