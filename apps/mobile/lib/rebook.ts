/** Data calendaristică (YYYY-MM-DD) la care serviciul devine din nou scadent. */
export function rebookDueDate(lastVisitAt: string | null, intervalDays: number): string | null {
  if (!lastVisitAt || !Number.isFinite(intervalDays) || intervalDays <= 0) return null;
  const last = new Date(lastVisitAt).getTime();
  if (!Number.isFinite(last)) return null;
  return new Date(last + intervalDays * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Clientul a depășit ritmul serviciului și merită reminder de revenire:
 * are vizită veche, intervalul e activ și nu are programare viitoare.
 */
export function isRebookDue(
  opts: { lastVisitAt: string | null; intervalDays: number; hasUpcoming: boolean },
  now: Date
): boolean {
  if (opts.hasUpcoming || !opts.lastVisitAt) return false;
  if (!Number.isFinite(opts.intervalDays) || opts.intervalDays <= 0) return false;
  const last = new Date(opts.lastVisitAt).getTime();
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last >= opts.intervalDays * 86_400_000;
}
