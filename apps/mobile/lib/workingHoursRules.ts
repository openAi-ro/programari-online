import type { BreakHours, WorkingHours } from './types';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Valid HH:mm range. An end before the start is an overnight range (ends next day, < 24 h). */
export function isValidTimeRange(start: string, end: string): boolean {
  return HHMM.test(start) && HHMM.test(end) && start !== end;
}

/** True when the range runs past midnight (e.g. 22:00–02:00). */
export function isOvernightRange(start: string, end: string): boolean {
  return HHMM.test(start) && HHMM.test(end) && end < start;
}

/** "22:00–02:00 (+1 zi)" for overnight ranges, "09:00–18:00" otherwise. */
export function formatTimeRange(start: string, end: string, nextDayLabel: string): string {
  const base = `${start}–${end}`;
  return isOvernightRange(start, end) ? `${base} ${nextDayLabel}` : base;
}

export type ScheduleError = 'hours' | 'break';

/**
 * Validează programul săptămânal și pauza înainte de salvare.
 * Întoarce codul erorii ('hours' sau 'break') sau null dacă totul e valid.
 */
export function validateSchedule(
  workingHours: WorkingHours,
  breakHours: BreakHours,
): ScheduleError | null {
  for (const day of Object.values(workingHours)) {
    if (!day || day.closed) continue;
    if (!isValidTimeRange(day.start, day.end)) return 'hours';
  }
  if (breakHours.enabled && !isValidTimeRange(breakHours.start, breakHours.end)) {
    return 'break';
  }
  return null;
}
