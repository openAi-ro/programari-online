import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Stocare sesiune web cu copie în cookie (iOS-1).
 * Safari șterge localStorage prin ITP după 7 zile fără vizită în tab, în mod
 * privat sau la „Șterge istoricul”. Cookie-ul first-party scris prin
 * document.cookie supraviețuiește ștergerii localStorage în scenariile în care
 * Safari păstrează cookie-urile site-ului, deci sesiunea se reface din cookie.
 * Cookie-ul are SameSite=Lax și Secure pe https. Valoarea e sesiunea Supabase
 * deja semnată (JWT), aceeași informație ca în localStorage.
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // ~400 zile, maximul practic în browsere

function cookieName(key: string): string {
  return `sb-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function readCookie(key: string): string | null {
  try {
    const name = cookieName(key);
    const parts = document.cookie ? document.cookie.split('; ') : [];
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      if (part.slice(0, eq) === name) {
        return decodeURIComponent(part.slice(eq + 1));
      }
    }
  } catch {
    // cookie indisponibil
  }
  return null;
}

function writeCookie(key: string, value: string): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${cookieName(key)}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    // cookie indisponibil
  }
}

function deleteCookie(key: string): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${cookieName(key)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    // cookie indisponibil
  }
}

export function createWebAuthStorage(): SupportedStorage {
  return {
    getItem: (key: string) => {
      try {
        const local = window.localStorage.getItem(key);
        if (local != null) return Promise.resolve(local);
      } catch {
        // localStorage indisponibil sau șters de ITP
      }
      const fromCookie = readCookie(key);
      if (fromCookie != null) {
        // Reface localStorage din cookie pentru citirile următoare.
        try {
          window.localStorage.setItem(key, fromCookie);
        } catch {
          // rămâne doar cookie-ul
        }
      }
      return Promise.resolve(fromCookie);
    },
    setItem: (key: string, value: string) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // continuă cu cookie-ul
      }
      writeCookie(key, value);
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // continuă cu cookie-ul
      }
      deleteCookie(key);
      return Promise.resolve();
    },
  };
}
