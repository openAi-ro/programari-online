import type { AuthError, Session } from '@supabase/supabase-js';

import { supabase } from './supabase';
import { getPublicWebOrigin } from './webBase';
import { Platform } from 'react-native';

import { trKey } from './i18n';
import { assertAccountKind, persistAccountKind } from './accountKind';
import {
  PENDING_GOOGLE_KIND_KEY,
  googleRedirectTo,
  isFreshSignup,
  resolveGoogleAccountKind,
} from './googleAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppMode } from './appMode';

/**
 * Where Supabase activation / reset emails redirect after click.
 * Always a public https URL so the link works from a phone, not just this PC.
 */
export function getEmailRedirectTo(): string {
  return `${getPublicWebOrigin()}/auth/callback`;
}

/** Open the installed app with the same tokens the web callback received. */
export function getNativeAuthCallbackUrl(fromUrl?: string | null): string {
  const params = fromUrl ? paramsFromAuthUrl(fromUrl) : new URLSearchParams();
  const qs = params.toString();
  return qs ? `programari://auth/callback?${qs}` : 'programari://auth/callback';
}

function paramsFromAuthUrl(url: string): URLSearchParams {
  const hashIdx = url.indexOf('#');
  const queryIdx = url.indexOf('?');
  const parts: string[] = [];
  if (queryIdx >= 0) {
    const end = hashIdx > queryIdx ? hashIdx : url.length;
    parts.push(url.slice(queryIdx + 1, end));
  }
  if (hashIdx >= 0) {
    parts.push(url.slice(hashIdx + 1));
  }
  return new URLSearchParams(parts.join('&').replace(/^[#?]/, ''));
}

export function isRecoveryAuthUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const type = (paramsFromAuthUrl(url).get('type') ?? '').toLowerCase();
  return type === 'recovery' || url.toLowerCase().includes('type=recovery');
}

export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('auth/callback') ||
    lower.includes('access_token=') ||
    lower.includes('type=signup') ||
    lower.includes('type=recovery') ||
    lower.includes('type=email') ||
    /[?&#]code=/.test(lower)
  );
}

/** Finish signup / magic-link / recovery from a deep link or web redirect. */
export async function completeAuthFromUrl(url: string): Promise<{
  session: Session | null;
  recovery: boolean;
  error: string | null;
}> {
  const recovery = isRecoveryAuthUrl(url);
  const params = paramsFromAuthUrl(url);
  const code = params.get('code');
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  try {
    if (code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return { session: null, recovery, error: error.message };
      return { session: data.session ?? null, recovery, error: null };
    }
    if (access_token && refresh_token) {
      const { data, error } = await supabase.auth.setSession({
        access_token,
        refresh_token,
      });
      if (error) return { session: null, recovery, error: error.message };
      return { session: data.session ?? null, recovery, error: null };
    }
    const { data } = await supabase.auth.getSession();
    return { session: data.session ?? null, recovery, error: null };
  } catch (e) {
    return {
      session: null,
      recovery,
      error: e instanceof Error ? e.message : trKey('auth.errActivateLink'),
    };
  }
}

let authRedirectHoldUntil = 0;

/** Ignore SIGNED_IN from signup so the app does not jump into home before activation. */
export function holdAuthRedirect(ms = 6000) {
  authRedirectHoldUntil = Date.now() + ms;
}

export function isAuthRedirectHeld(): boolean {
  return Date.now() < authRedirectHoldUntil;
}

/** Email accounts must click the activation link. Phone (WhatsApp) uses OTP instead. */
export function sessionIsReadyForApp(session: Session | null | undefined): boolean {
  const user = session?.user;
  if (!user) return false;
  if (user.email && !user.email_confirmed_at) return false;
  if (!user.email && user.phone && !user.phone_confirmed_at) return false;
  return Boolean(user.email || user.phone);
}

export function isDuplicateSignupUser(user: { identities?: { id?: string }[] | null } | null | undefined) {
  if (!user) return false;
  return (user.identities?.length ?? 0) === 0;
}

/** Map Supabase auth errors to localized UI messages. */
export function mapAuthError(error: AuthError | Error | null | undefined): string | null {
  if (!error) return null;
  const raw = (error.message || '').toLowerCase();
  if (
    raw.includes('unsupported phone provider') ||
    raw.includes('phone provider') ||
    (raw.includes('sms') && raw.includes('not'))
  ) {
    return trKey('auth.errPhoneProvider');
  }
  if (raw.includes('email rate limit') || raw.includes('rate limit')) {
    return trKey('auth.errRateLimit');
  }
  if (
    raw.includes('invalid login') ||
    raw.includes('invalid credentials') ||
    raw.includes('invalid password')
  ) {
    return trKey('auth.errInvalidLogin');
  }
  if (raw.includes('user already registered') || raw.includes('already been registered')) {
    return trKey('auth.errAlreadyRegistered');
  }
  if (raw.includes('already confirmed') || raw.includes('email is already confirmed')) {
    return trKey('auth.errAlreadyConfirmed');
  }
  if (raw.includes('password') && raw.includes('at least')) {
    return trKey('auth.passwordMinLength');
  }
  if (raw.includes('email not confirmed') || raw.includes('email_not_confirmed')) {
    return trKey('auth.errNotConfirmed');
  }
  if (raw.includes('confirm') && raw.includes('email')) {
    return trKey('auth.errNotConfirmed');
  }
  if (
    raw.includes('same email rate') ||
    raw.includes('for security purposes') ||
    raw.includes('only request this after')
  ) {
    return trKey('auth.errEmailRateLimit');
  }
  if (
    raw.includes('weak password') ||
    raw.includes('password should be') ||
    (raw.includes('password') && (raw.includes('too short') || raw.includes('too weak')))
  ) {
    return trKey('auth.errWeakPassword');
  }
  if (
    raw.includes('expired') ||
    raw.includes('otp_expired') ||
    raw.includes('flow state') ||
    (raw.includes('recovery') && (raw.includes('invalid') || raw.includes('expired')))
  ) {
    return trKey('auth.errExpiredLink');
  }
  if (raw.includes('invalid otp') || raw.includes('token')) {
    return trKey('auth.errInvalidToken');
  }
  return error.message;
}

/** Cont nou cu email + parolă. Trimite link de activare. Nu lasă sesiune activă. */
export async function signUpWithPassword(
  email: string,
  password: string,
  accountKind: 'client' | 'business'
) {
  holdAuthRedirect();
  const result = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: getEmailRedirectTo(),
      data: { account_kind: accountKind },
    },
  });
  if (result.data.session) {
    await supabase.auth.signOut();
  }
  return result;
}

/** Retrimite emailul cu linkul de activare. */
export async function resendSignupEmail(email: string) {
  return supabase.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: getEmailRedirectTo() },
  });
}

/** Login cu email + parolă. Contul trebuie să fie activat din email. */
export async function signInWithPassword(email: string, password: string) {
  const result = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (result.data.session && !sessionIsReadyForApp(result.data.session)) {
    holdAuthRedirect();
    await supabase.auth.signOut();
    return {
      data: { user: null, session: null },
      error: {
        name: 'AuthApiError',
        message: 'Email not confirmed',
        status: 400,
        code: 'email_not_confirmed',
      } as AuthError,
    };
  }
  return result;
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

/** Ține minte ușa (client/business) pe durata redirectului Google. */
async function rememberPendingGoogleKind(kind: AppMode): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_GOOGLE_KIND_KEY, kind);
  } catch {
    /* best-effort */
  }
}

/** Citește și uită ușa ținută minte pentru logarea Google. */
export async function takePendingGoogleKind(): Promise<AppMode | null> {
  try {
    const value = await AsyncStorage.getItem(PENDING_GOOGLE_KIND_KEY);
    await AsyncStorage.removeItem(PENDING_GOOGLE_KIND_KEY);
    return value ? (value === 'business' ? 'business' : 'client') : null;
  } catch {
    return null;
  }
}

/** Adresa de întoarcere după logarea cu Google. */
export function getGoogleRedirectTo(): string {
  return googleRedirectTo(Platform.OS, getPublicWebOrigin());
}

/**
 * Pornește logarea cu Google pentru ușa dată (client/business).
 * Întoarce URL-ul de autorizare; apelantul îl deschide (browser pe web,
 * sesiune de autentificare pe nativ).
 */
export async function startGoogleSignIn(
  kind: AppMode
): Promise<{ url: string | null; error: string | null }> {
  await rememberPendingGoogleKind(kind);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getGoogleRedirectTo(),
      skipBrowserRedirect: true,
      queryParams: { access_type: 'offline', prompt: 'select_account' },
    },
  });
  if (error) return { url: null, error: error.message };
  return { url: data.url ?? null, error: null };
}

/**
 * Termină logarea Google din URL-ul de callback și fixează rolul contului:
 * profilul existent nu se răsturnează; cont nou → ușa aleasă.
 */
export async function completeGoogleSignIn(
  url: string,
  expectedKind: AppMode
): Promise<{ session: Session | null; error: string | null }> {
  const result = await completeAuthFromUrl(url);
  if (result.error || !result.session) {
    return { session: null, error: result.error };
  }
  const user = result.session.user;
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_kind')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || isFreshSignup(user)) {
    const pending = await takePendingGoogleKind();
    await persistAccountKind(
      resolveGoogleAccountKind({
        metadataKind: user.user_metadata?.account_kind as string | undefined,
        pendingKind: pending ?? expectedKind,
        profileKind: null,
      })
    );
  }
  const check = await assertAccountKind(expectedKind);
  if (!check.ok) {
    return { session: null, error: check.error };
  }
  return { session: result.session, error: null };
}

export async function signOut() {
  // Șterge token-ul push al dispozitivului ca telefonul să nu mai primească
  // popup-uri remote după deconectare (cont schimbat / dispozitiv predat).
  try {
    const { unregisterCurrentPushToken } = await import('./notifications');
    await unregisterCurrentPushToken();
  } catch {
    // best-effort — logout-ul continuă oricum
  }
  return supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
