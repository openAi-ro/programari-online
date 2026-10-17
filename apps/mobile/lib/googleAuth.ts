import type { AppMode } from './appMode';

/** Aceeași regulă ca parseAccountKind, fără dependențe de runtime. */
function parseKind(value: string | null | undefined): AppMode {
  return value === 'business' ? 'business' : 'client';
}

export const PENDING_GOOGLE_KIND_KEY = 'auth.googleKind';

/** Unde se întoarce utilizatorul după Google: web https, nativ schema aplicației. */
export function googleRedirectTo(platform: string, webOrigin: string): string {
  if (platform === 'web') return `${webOrigin}/auth/callback`;
  return 'programari://auth/callback';
}

/**
 * Primul login Google: contul tocmai a fost creat (trigger-ul handle_new_user
 * a pus deja profil implicit "client"), deci usa aleasa trebuie sa castige.
 */
export function isFreshSignup(
  user: { created_at?: string | null; last_sign_in_at?: string | null } | null | undefined,
  windowMs = 120_000,
): boolean {
  if (!user?.created_at) return false;
  const created = Date.parse(user.created_at);
  const last = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : created;
  if (Number.isNaN(created) || Number.isNaN(last)) return false;
  return Math.abs(last - created) <= windowMs;
}

type GoogleUserLike = {
  app_metadata?: { provider?: string | null } | null;
  identities?: Array<{ provider?: string | null }> | null;
} | null | undefined;

/** Utilizatorul are o identitate Google (principală sau legată ulterior). */
export function isGoogleUser(user: GoogleUserLike): boolean {
  if (!user) return false;
  if (user.app_metadata?.provider === 'google') return true;
  return (user.identities ?? []).some((i) => i?.provider === 'google');
}

/**
 * Rolul contului după logarea Google, fără răsturnări:
 * profilul existent câștigă; apoi metadata; apoi ușa aleasă; implicit client.
 */
export function resolveGoogleAccountKind(opts: {
  metadataKind?: string | null;
  pendingKind?: string | null;
  profileKind?: string | null;
}): AppMode {
  if (opts.profileKind) return parseKind(opts.profileKind);
  if (opts.metadataKind) return parseKind(opts.metadataKind);
  if (opts.pendingKind) return parseKind(opts.pendingKind);
  return 'client';
}

