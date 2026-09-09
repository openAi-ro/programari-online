import type { AuthError, Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';

import { supabase } from './supabase';

/**
 * Where Supabase magic-links redirect after click.
 * Must be listed under Dashboard → Auth → URL Configuration → Redirect URLs.
 */
export function getEmailRedirectTo(): string {
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
    return 'Login cu telefon nu e activ pe server. Folosește email + parolă.';
  }
  if (raw.includes('email rate limit') || raw.includes('rate limit')) {
    return 'Prea multe încercări. Așteaptă câteva minute.';
  }
  if (
    raw.includes('invalid login') ||
    raw.includes('invalid credentials') ||
    raw.includes('invalid password')
  ) {
    return 'Email sau parolă greșită.';
  }
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return 'Contul există deja. Folosește „Intră în cont” cu parola ta.';
  }
  if (raw.includes('password') && raw.includes('at least')) {
    return 'Parola trebuie să aibă cel puțin 6 caractere.';
  }
  if (raw.includes('email not confirmed') || raw.includes('confirm')) {
    return 'Email neconfirmat. În Supabase: Auth → Providers → Email → dezactivează „Confirm email” (pentru dezvoltare), sau confirmă din mail după ce Site URL e http://localhost:8084.';
  }
  if (
    raw.includes('same email rate') ||
    raw.includes('for security purposes') ||
    raw.includes('only request this after')
  ) {
    return 'Prea multe cereri pentru acest email. Așteaptă câteva minute și încearcă din nou.';
  }
  if (
    raw.includes('weak password') ||
    raw.includes('password should be') ||
    (raw.includes('password') && (raw.includes('too short') || raw.includes('too weak')))
  ) {
    return 'Parola e prea slabă. Folosește cel puțin 6 caractere.';
  }
  if (
    raw.includes('expired') ||
    raw.includes('otp_expired') ||
    raw.includes('flow state') ||
    (raw.includes('recovery') && (raw.includes('invalid') || raw.includes('expired')))
  ) {
    return 'Linkul de resetare a expirat sau nu mai e valid. Cere un link nou.';
  }
  if (raw.includes('invalid otp') || raw.includes('token')) {
    return 'Cod invalid. Supabase îți trimite acum doar link „Sign in”, nu cod — folosește email + parolă.';
  }
  return error.message;
}

/** Cont nou cu email + parolă (recomandat pe telefon). */
export async function signUpWithPassword(email: string, password: string) {
  return supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
    },
  });
}

/** Login cu email + parolă. */
export async function signInWithPassword(email: string, password: string) {
  return supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

/**
 * Magic link / OTP email.
 * Implicit Supabase trimite DOAR link „Sign in” (nu cod), dacă template-ul nu are {{ .Token }}.
 */
export async function sendEmailOtp(email: string) {
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      shouldCreateUser: true,
      emailRedirectTo: getEmailRedirectTo(),
    },
  });
}

export async function sendPhoneOtp(phone: string) {
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

/** Trimite email cu link de resetare a parolei (nu divulgă dacă emailul există). */
export async function resetPasswordForEmail(email: string) {
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: getEmailRedirectTo(),
  });
}

/** Setează parola nouă după ce sesiunea de recovery e activă. */
export async function updatePassword(newPassword: string) {
  return supabase.auth.updateUser({ password: newPassword });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
