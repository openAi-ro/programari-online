import type { BreakHours, WorkingHours } from './types';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function validRange(start: string, end: string): boolean {
  return HHMM.test(start) && HHMM.test(end) && toMinutes(start) < toMinutes(end);
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
    if (!validRange(day.start, day.end)) return 'hours';
  }
  if (breakHours.enabled && !validRange(breakHours.start, breakHours.end)) {
    return 'break';
  }
  return null;
}
