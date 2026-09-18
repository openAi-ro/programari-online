/** After login, send the user back to the public booking page. */

const STORAGE_KEY = 'programari.authRedirect';

let pending: string | null = null;

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function setPendingAuthRedirect(path: string) {
  pending = path;
  webStore()?.setItem(STORAGE_KEY, path);
}

/** Citește redirect-ul fără a-l șterge (ex. buton Înapoi de pe ecranul de login). */
export function peekPendingAuthRedirect(): string | null {
  return pending || webStore()?.getItem(STORAGE_KEY) || null;
}

export function clearPendingAuthRedirect() {
  pending = null;
  webStore()?.removeItem(STORAGE_KEY);
}

export function consumePendingAuthRedirect(): string | null {
  const stored = webStore()?.getItem(STORAGE_KEY) ?? null;
  const next = pending || stored;
  pending = null;
  webStore()?.removeItem(STORAGE_KEY);
  return next;
}
