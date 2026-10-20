/**
 * True only for a complete, real calendar date "YYYY-MM-DD" with a plausible year.
 * The web <input type="date"> emits partial years while typing ("0002-10-22",
 * "0202-10-22"); those must never reach slot loading / date math.
 */
export function isCompleteYmd(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Why a typed date can't be used yet (null = usable). */
export type DateInputIssue = 'incomplete' | 'outOfRange';

/**
 * Classifies what the web date input holds. min/max are "YYYY-MM-DD" (inclusive);
 * the popup respects min/max, typed dates don't, so they're checked here.
 */
export function dateInputIssue(raw: string, minYmd?: string, maxYmd?: string): DateInputIssue | null {
  if (!isCompleteYmd(raw)) return 'incomplete';
  if ((minYmd && raw < minYmd) || (maxYmd && raw > maxYmd)) return 'outOfRange';
  return null;
}
