import { fromZonedTime, toZonedTime } from './timezone';

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
/** Selecția din UI: 1 înseamnă o singură ședință; 2..8 înseamnă serie. */
export function normalizeRepeatSelection(n: number): number {
  if (!Number.isFinite(n) || n <= 1) return 1;
  return clampRepeatCount(n);
}

export function buildWeeklyStarts(
  startUtcIso: string,
  count: number,
  timezone?: string,
): string[] {
  if (!Number.isFinite(count) || count < REPEAT_MIN) return [];
  const n = Math.min(REPEAT_MAX, Math.floor(count));
  const base = new Date(startUtcIso);
  if (!Number.isFinite(base.getTime())) return [];

  if (!timezone) {
    const week = 7 * 24 * 60 * 60 * 1000;
    return Array.from({ length: n }, (_, i) => new Date(base.getTime() + i * week).toISOString());
  }

  // Cu timezone: zilele se aduna calendaristic in fusul firmei,
  // ca ora locala sa ramana aceeasi si peste trecerea DST.
  const starts: string[] = [];
  let cursor = base;
  for (let i = 0; i < n; i += 1) {
    starts.push(cursor.toISOString());
    const zoned = toZonedTime(cursor, timezone);
    zoned.setDate(zoned.getDate() + 7);
    cursor = fromZonedTime(zoned, timezone);
  }
  return starts;
}
