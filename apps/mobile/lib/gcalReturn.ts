/** Întoarcerea din Google Calendar (callback-ul redirecționează aici). Fără dependențe de runtime. */

export type GcalReturnReason = 'config' | 'server' | 'state' | 'business' | 'auth' | 'save' | 'scope';

const REASONS: GcalReturnReason[] = ['config', 'server', 'state', 'business', 'auth', 'save', 'scope'];

export const GCAL_APP_DEEP_LINK = 'programari://business/settings';
export const GCAL_APP_PATH = '/business/settings';

/** Cheia de text pentru rezultat (ok sau motivul erorii). */
export function gcalReturnMessageKey(status: string | null, reason: string | null): string {
  if (status === 'ok') return 'gcal.retOk';
  const r = REASONS.includes(reason as GcalReturnReason) ? (reason as GcalReturnReason) : 'auth';
  return `gcal.ret_${r}`;
}

/** Telefon în browser (unde aplicația poate fi deschisă prin schema programari://). */
export function isMobileUserAgent(ua: string | null | undefined): boolean {
  return /android|iphone|ipad|ipod/i.test(ua ?? '');
}

/**
 * Unde duce butonul „Întoarce-te în aplicație”:
 * nativ → ecranul Setări din app; web pe telefon → încearcă aplicația, apoi Setări pe web;
 * web pe desktop → Setări pe web.
 */
export function gcalReturnTarget(
  platform: string,
  userAgent: string | null | undefined,
): { deepLink: string | null; path: string } {
  if (platform !== 'web') return { deepLink: null, path: GCAL_APP_PATH };
  return {
    deepLink: isMobileUserAgent(userAgent) ? GCAL_APP_DEEP_LINK : null,
    path: GCAL_APP_PATH,
  };
}