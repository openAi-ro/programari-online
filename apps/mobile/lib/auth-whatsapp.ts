import type { User } from '@supabase/supabase-js';

import { normalizePhoneE164 } from './phone';
import { trKey } from './i18n';
import { getLanguageSync } from './language';
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';

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
  created?: boolean;
};

type FnJson = {
  ok?: boolean;
  stub?: boolean;
  error?: string;
  hint?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: User;
  created?: boolean;
};

/**
 * Call public WhatsApp OTP functions with the anon key.
 * Avoids sending a leftover/expired user JWT (which 401s when verify_jwt is on).
 */
async function invokePublicAuthFunction(
  name: string,
  body: Record<string, unknown>
): Promise<{ data: FnJson | null; error: string | null }> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      data: null,
      error: trKey('wa.appNotConfigured'),
    };
  }

  let res: Response;
  try {
    res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      data: null,
      error: trKey('wa.noServer'),
    };
  }

  let payload: FnJson | null = null;
  try {
    payload = (await res.json()) as FnJson;
  } catch {
    payload = null;
  }

  if (!res.ok) {
    if (res.status === 404) {
      return {
        data: payload,
        error:
          trKey('wa.fnMissing'),
      };
    }
    if (res.status === 401) {
      return {
        data: payload,
        error:
          trKey('wa.jwtRejected'),
      };
    }
    return {
      data: payload,
      error:
        payload?.hint ||
        payload?.error ||
        trKey('wa.requestFailed', { code: res.status }),
    };
  }

  if (payload?.error) {
    return {
      data: payload,
      error: payload.hint || payload.error,
    };
  }

  return { data: payload, error: null };
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
      error: trKey('auth.validNumber'),
    };
  }

  const { data, error } = await invokePublicAuthFunction('auth-whatsapp-otp', {
    phone,
    lang: getLanguageSync(),
  });

  if (error) {
    return { data: null, error };
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
  codeRaw: string,
  accountKind: 'client' | 'business' = 'client'
): Promise<{
  data: WhatsAppOtpSession | null;
  error: string | null;
}> {
  const phone = normalizePhoneE164(phoneRaw);
  const code = codeRaw.replace(/\D/g, '');
  if (!phone) {
    return {
      data: null,
      error: trKey('auth.validNumber'),
    };
  }
  if (!/^\d{6}$/.test(code)) {
    return { data: null, error: trKey('auth.waCode6') };
  }

  const { data, error } = await invokePublicAuthFunction(
    'auth-whatsapp-verify',
    { phone, code, account_kind: accountKind, lang: getLanguageSync() }
  );

  if (error) {
    return { data: null, error };
  }

  if (!data?.access_token || !data?.refresh_token) {
    return {
      data: null,
      error: data?.hint || data?.error || trKey('wa.verifyFailed'),
    };
  }

  return {
    data: {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in ?? 3600,
      expires_at: data.expires_at,
      token_type: data.token_type,
      user: data.user as User,
      created: data.created === true,
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
