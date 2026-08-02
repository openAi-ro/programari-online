import type { AuthError, Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

/** Map Supabase auth errors to Romanian UI messages. */
export function mapAuthError(error: AuthError | Error | null | undefined): string | null {
  if (!error) return null;
  const raw = (error.message || '').toLowerCase();
  if (
    raw.includes('unsupported phone provider') ||
    raw.includes('phone provider') ||
    (raw.includes('sms') && raw.includes('not'))
  ) {
    return 'Login cu telefon nu e activ pe server. Folosește email (OTP pe mail). Pentru SMS trebuie configurat un provider (ex. Twilio) în Supabase → Auth → Providers → Phone.';
  }
  if (raw.includes('email rate limit') || raw.includes('rate limit')) {
    return 'Prea multe încercări. Așteaptă câteva minute și încearcă din nou.';
  }
  if (raw.includes('invalid login') || raw.includes('invalid otp') || raw.includes('token')) {
    return 'Cod invalid sau expirat. Cere un cod nou.';
  }
  return error.message;
}

export async function sendEmailOtp(email: string) {
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
}

export async function sendPhoneOtp(phone: string) {
  // Phone OTP requires an SMS provider in Supabase (Twilio, MessageBird, etc.).
  // Without it, API returns "Unsupported phone provider".
  return supabase.auth.signInWithOtp({
    phone: phone.trim(),
    options: { shouldCreateUser: true },
  });
}

export async function verifyOtp(params: {
  email?: string;
  phone?: string;
  token: string;
  type: 'email' | 'sms';
}) {
  if (params.type === 'email') {
    return supabase.auth.verifyOtp({
      email: params.email!.trim(),
      token: params.token.trim(),
      type: 'email',
    });
  }
  return supabase.auth.verifyOtp({
    phone: params.phone!.trim(),
    token: params.token.trim(),
    type: 'sms',
  });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
