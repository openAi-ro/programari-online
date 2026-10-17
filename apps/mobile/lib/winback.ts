type WinbackRow = {
  visit_count: number;
  last_start_at: string | null;
  upcoming_count: number;
};

/** Zile întregi de la ultima vizită; null dacă nu există o dată validă. */
export function daysSinceLastVisit(lastStartAt: string | null, now: Date): number | null {
  if (!lastStartAt) return null;
  const last = new Date(lastStartAt).getTime();
  if (!Number.isFinite(last)) return null;
  return Math.floor((now.getTime() - last) / 86_400_000);
}

/**
 * Client de reactivat: a mai fost cel puțin o dată, nu a mai venit
 * de `days` zile și nu are programare viitoare.
 */
export function isWinbackCandidate(row: WinbackRow, now: Date, days = 30): boolean {
  if ((row.visit_count ?? 0) < 1) return false;
  if ((row.upcoming_count ?? 0) > 0) return false;
  const since = daysSinceLastVisit(row.last_start_at, now);
  return since !== null && since >= days;
}
