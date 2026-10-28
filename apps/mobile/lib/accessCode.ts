/**
 * Coduri de invitație pentru business-uri private (v99). Reguli pure, fără rețea:
 * aceeași normalizare ca `normalize_access_code` din DB (majuscule, doar A–Z/0–9).
 */

/** Alfabetul generatorului din DB: fără 0/O, 1/I/L — ușor de dictat. */
export const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ACCESS_CODE_LENGTH = 12;

export function normalizeAccessCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** XXXX-XXXX-XXXX pentru afișare (și pe măsură ce utilizatorul tastează). */
export function formatAccessCode(raw: string): string {
  const n = normalizeAccessCode(raw).slice(0, ACCESS_CODE_LENGTH);
  return n.match(/.{1,4}/g)?.join('-') ?? '';
}

/** Doar pentru activarea butonului; validarea reală e pe server (mesaj generic). */
export function isCompleteAccessCode(raw: string): boolean {
  return normalizeAccessCode(raw).length === ACCESS_CODE_LENGTH;
}

export type ExpiryPreset = '24h' | '7d' | '30d';

export const EXPIRY_PRESET_MS: Record<ExpiryPreset, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 24 * 3600_000,
  '30d': 30 * 24 * 3600_000,
};

/** Limitele serverului (create_business_access_code): acum+5 min … acum+366 zile. */
export const EXPIRY_MIN_MS = 5 * 60_000;
export const EXPIRY_MAX_MS = 366 * 24 * 3600_000;
export const MAX_USES_LIMIT = 1000;

export function presetExpiry(preset: ExpiryPreset, now = new Date()): Date {
  return new Date(now.getTime() + EXPIRY_PRESET_MS[preset]);
}

/**
 * Data/ora personalizată „ZZ.LL.AAAA HH:MM” (ora locală a dispozitivului).
 * Întoarce null dacă formatul e greșit sau data nu există.
 */
export function parseCustomExpiry(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh = '23', mi = '59'] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
  if (
    d.getFullYear() !== Number(yyyy) ||
    d.getMonth() !== Number(mm) - 1 ||
    d.getDate() !== Number(dd) ||
    d.getHours() !== Number(hh) ||
    d.getMinutes() !== Number(mi)
  ) {
    return null;
  }
  return d;
}

export type ExpiryError = 'format' | 'tooSoon' | 'tooLate';

export function expiryError(d: Date | null, now = new Date()): ExpiryError | null {
  if (!d) return 'format';
  const delta = d.getTime() - now.getTime();
  if (delta < EXPIRY_MIN_MS) return 'tooSoon';
  if (delta > EXPIRY_MAX_MS) return 'tooLate';
  return null;
}

/** Număr de utilizări 1…1000; null = invalid. */
export function parseMaxUses(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MAX_USES_LIMIT ? n : null;
}
