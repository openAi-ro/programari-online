import type { AuthError, Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { supabase } from './supabase';

/**
 * Where Supabase email magic-links redirect after click.
 * Must be listed under Dashboard → Auth → URL Configuration → Redirect URLs.
 * Prefer OTP code in the app — do not rely on the link if Site URL is wrong.
 */
export function getEmailRedirectTo(): string {
  // Web: current origin (e.g. http://localhost:8084)
  // Native: programari:// scheme from app.json
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/auth/callback`;
  }
  return Linking.createURL('auth/callback');
}

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
  if (raw.includes('email not confirmed') || raw.includes('confirm')) {
    return 'Email neconfirmat. Folosește codul din mesaj (nu linkul) sau confirmă din mail după ce ai setat URL-urile în Supabase.';
  }
  return error.message;
}

export async function sendEmailOtp(email: string) {
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      // Avoid default Site URL (often localhost:3000) which refuses connection
      emailRedirectTo: getEmailRedirectTo(),
    },
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
