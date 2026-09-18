import { supabase } from './supabase';
import { setAppMode, type AppMode } from './appMode';

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

  const patch: {
    id: string;
    account_kind: AppMode;
    email?: string;
    phone?: string;
  } = { id: user.id, account_kind: kind };
  if (user.email) patch.email = user.email;
  if (user.phone) patch.phone = user.phone;

  const { error } = await supabase.from('profiles').upsert(patch, { onConflict: 'id' });
  if (error) {
    console.warn('persistAccountKind failed', error.message);
  }
}

/**
 * After login: the account must match the door they used (client vs business).
 * On mismatch, sign out and return a Romanian error.
 */
export async function assertAccountKind(
  expected: AppMode
): Promise<{ ok: true } | { ok: false; error: string }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Trebuie să fii autentificat.' };
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
          ? 'Acest cont e de business. Întoarce-te și alege „Cont business”.'
          : 'Acest cont e de client. Întoarce-te și alege „Cont client”.',
    };
  }

  await setAppMode(expected);
  return { ok: true };
}
