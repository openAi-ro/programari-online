import { supabase } from './supabase';
import { setAppMode, type AppMode } from './appMode';
import { trKey } from './i18n';

export function parseAccountKind(value: string | null | undefined): AppMode {
  return value === 'business' ? 'business' : 'client';
}

/** Persist the chosen account type on the profile (used at registration). */
export async function persistAccountKind(kind: AppMode): Promise<void> {
  await setAppMode(kind);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, email, phone')
    .eq('id', user.id)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from('profiles').insert({
      id: user.id,
      account_kind: kind,
      email: user.email ?? null,
      phone: user.phone ?? null,
    });
    if (error) console.warn('persistAccountKind insert failed', error.message);
    return;
  }

  const patch: {
    account_kind: AppMode;
    email?: string | null;
    phone?: string | null;
  } = { account_kind: kind };
  // Nu suprascriem un telefon deja salvat din Setări.
  if (!existing.email && user.email) patch.email = user.email;
  if (!existing.phone && user.phone) patch.phone = user.phone;

  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) {
    console.warn('persistAccountKind update failed', error.message);
  }
}

/**
 * After login: the account must match the door they used (client vs business).
 * On mismatch, sign out and return a localized error.
 */
export async function assertAccountKind(
  expected: AppMode
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: trKey('auth.errMustSignIn') };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('account_kind')
    .eq('id', user.id)
    .maybeSingle();

  const actual = parseAccountKind(profile?.account_kind);
  if (actual !== expected) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        actual === 'business'
          ? trKey('auth.errNeedBusiness')
          : trKey('auth.errNeedClient'),
    };
  }

  await setAppMode(expected);
  return { ok: true };
}
