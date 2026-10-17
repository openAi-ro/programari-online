/**
 * Clientul își poate anunța sosirea din ziua programării:
 * cu cel mult 60 de minute înainte și până la 4 ore după începere,
 * doar pentru programări aprobate încă nemarcate.
 */
/** Fereastra de sosire începe cu 60 min înainte (aceeași regulă ca mark_checked_in pe server). */
export const CHECKIN_OPEN_BEFORE_MS = 60 * 60_000;

export function canCheckIn(
  opts: { status: string; startAt: string; checkedInAt: string | null },
  now: Date
): boolean {
  if (opts.status !== 'approved' || opts.checkedInAt) return false;
  const start = new Date(opts.startAt).getTime();
  if (!Number.isFinite(start)) return false;
  const diff = now.getTime() - start;
  return diff >= -CHECKIN_OPEN_BEFORE_MS && diff <= 4 * 3_600_000;
}
