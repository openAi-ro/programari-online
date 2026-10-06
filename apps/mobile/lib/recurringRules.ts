export const REPEAT_MIN = 2;
export const REPEAT_MAX = 8;

/** Limiteaza numarul de repetitii saptamanale la 2..8. */
export function clampRepeatCount(n: number): number {
  if (!Number.isFinite(n)) return REPEAT_MIN;
  return Math.min(REPEAT_MAX, Math.max(REPEAT_MIN, Math.floor(n)));
}

/**
 * Momentele de start (ISO UTC) pentru o serie saptamanala, aceeasi ora.
 * Intoarce gol cand count < 2 (o singura sedinta nu e recurenta).
 */
export function buildWeeklyStarts(startUtcIso: string, count: number): string[] {
  if (!Number.isFinite(count) || count < REPEAT_MIN) return [];
  const n = Math.min(REPEAT_MAX, Math.floor(count));
  const base = new Date(startUtcIso).getTime();
  if (!Number.isFinite(base)) return [];
  const week = 7 * 24 * 60 * 60 * 1000;
  return Array.from({ length: n }, (_, i) => new Date(base + i * week).toISOString());
}
