import type { Session } from '@supabase/supabase-js';

import { supabase } from './supabase';

export async function sendEmailOtp(email: string) {
  return supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
}

export async function sendPhoneOtp(phone: string) {
  // E.164, e.g. +40722123456
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
