/**
 * Normalize Romanian / international numbers to E.164 (+40...).
 */
export function normalizePhoneE164(
  raw: string | null | undefined,
  defaultCountry = '40'
): string | null {
  if (!raw?.trim()) return null;

  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  // 0039… / 0040… (prefix internațional)
  if (digits.startsWith('00')) digits = digits.slice(2);

  if (digits.startsWith('0') && digits.length >= 10) {
    digits = defaultCountry + digits.slice(1);
  }

  if (
    !digits.startsWith(defaultCountry) &&
    digits.length === 9 &&
    digits.startsWith('7')
  ) {
    digits = defaultCountry + digits;
  }

  if (digits.length < 10) return null;
  return `+${digits}`;
}

export function isValidRoMobile(e164: string | null): boolean {
  if (!e164) return false;
  return /^\+40(7\d{8}|2\d{8}|3\d{8})$/.test(e164);
}

export function formatPhoneDisplay(e164: string | null): string {
  if (!e164) return '—';
  if (e164.startsWith('+40') && e164.length === 12) {
    return `0${e164.slice(3)}`;
  }
  return e164;
}

export type PhoneProblem = 'invalid' | 'notRo' | null;

/** Problema unui telefon de salvat (gol = fără problemă: telefonul e opțional). */
export function phoneProblem(raw: string): PhoneProblem {
  if (!raw.trim()) return null;
  const e164 = normalizePhoneE164(raw.trim());
  if (!e164) return 'invalid';
  return isValidRoMobile(e164) ? null : 'notRo';
}

/**
 * Problema de arătat sub câmp în timp ce se scrie (test încrucișat, Designer F-6): litere
 * imediat; restul doar după ce numărul are destule cifre, ca „07” să nu apară ca eroare.
 */
export function phoneTypingProblem(raw: string): PhoneProblem {
  if (/[^\d+\s().-]/.test(raw)) return 'invalid';
  if (raw.replace(/\D/g, '').length < 10) return null;
  return phoneProblem(raw);
}
