/**
 * Clientul își poate anunța sosirea cu cel mult 60 de minute înainte de începere
 * și până la sfârșitul programării, doar pentru programări aprobate încă nemarcate.
 */
/** Fereastra de sosire începe cu 60 min înainte (aceeași regulă ca mark_checked_in pe server). */
export const CHECKIN_OPEN_BEFORE_MS = 60 * 60_000;

export function canCheckIn(
  opts: { status: string; startAt: string; endAt: string; checkedInAt: string | null },
  now: Date
): boolean {
  if (opts.status !== 'approved' || opts.checkedInAt) return false;
  const start = new Date(opts.startAt).getTime();
  const end = new Date(opts.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const t = now.getTime();
  return t >= start - CHECKIN_OPEN_BEFORE_MS && t < end;
}
