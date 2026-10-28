/**
 * Categoria „General” (v98): business-ul își scrie singur specializarea.
 * Aceeași regulă ca CHECK-ul din DB: obligatorie doar pentru category='general', 2–40 caractere.
 */
export const GENERAL_CATEGORY_KEY = 'general';
export const SPECIALIZATION_MIN = 2;
export const SPECIALIZATION_MAX = 40;

/** Trim + spații multiple → unul (DB cere valoare fără spații la capete). */
export function normalizeSpecialization(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export type SpecializationError = 'empty' | 'tooShort' | 'tooLong';

/** null = valid. */
export function specializationError(raw: string): SpecializationError | null {
  const v = normalizeSpecialization(raw);
  if (!v) return 'empty';
  if (v.length < SPECIALIZATION_MIN) return 'tooShort';
  if (v.length > SPECIALIZATION_MAX) return 'tooLong';
  return null;
}
