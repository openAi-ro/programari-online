import type { BreakHours, FreeSlot, WorkingHours } from './types';
import {
  dayKeyForDateLocal,
  formatLocalTime,
  localDateTimeToUtc,
} from './timezone';

export type BusyRange = { startUtc: string; endUtc: string };

export type GenerateFreeSlotsInput = {
  dateLocal: string; // YYYY-MM-DD
  timezone: string;
  sessionDurationMinutes: number;
  workingHours: WorkingHours;
  breakHours: BreakHours;
  busy: BusyRange[];
  /** Extra minutes after each slot / busy range (prep between clients). */
  bufferMinutes?: number;
  /** YYYY-MM-DD days the business is closed (holiday / leave). */
  blockedDates?: string[];
  /** Hide slots that start at or before this instant (min notice / now). */
  notBeforeUtc?: string | Date;
};

/** Overlap: [aStart, aEnd) overlaps [bStart, bEnd) if aStart < bEnd && bStart < aEnd */
export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseHHmm(time: string): { hours: number; minutes: number } {
  const [h, m] = time.split(':').map(Number);
  return { hours: h, minutes: m ?? 0 };
}

function hhmmToMinutes(time: string): number {
  const { hours, minutes } = parseHHmm(time);
  return hours * 60 + minutes;
}

function minutesToHHmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Generate free slots for a local calendar day in the business timezone.
 * Steps through working hours by session duration, excludes break and busy overlaps.
 */
export function generateFreeSlots(input: GenerateFreeSlotsInput): FreeSlot[] {
  const {
    dateLocal,
    timezone,
    sessionDurationMinutes,
    workingHours,
    breakHours,
    busy,
    bufferMinutes = 0,
    blockedDates = [],
    notBeforeUtc,
  } = input;

  if (sessionDurationMinutes <= 0) return [];
  if (blockedDates.includes(dateLocal)) return [];

  const dayKey = dayKeyForDateLocal(dateLocal, timezone);
  const dayHours = workingHours[dayKey];
  if (!dayHours || dayHours.closed) return [];

  const workStartMin = hhmmToMinutes(dayHours.start);
  const workEndMin = hhmmToMinutes(dayHours.end);
  if (workEndMin <= workStartMin) return [];

  const breakEnabled = breakHours?.enabled === true;
  const breakStartMin = breakEnabled ? hhmmToMinutes(breakHours.start) : 0;
  const breakEndMin = breakEnabled ? hhmmToMinutes(breakHours.end) : 0;

  const bufferMs = Math.max(0, bufferMinutes) * 60 * 1000;
  const stepMinutes = sessionDurationMinutes + Math.max(0, bufferMinutes);
  const notBefore = notBeforeUtc
    ? notBeforeUtc instanceof Date
      ? notBeforeUtc
      : new Date(notBeforeUtc)
    : null;

  const busyRanges = busy.map((b) => ({
    start: new Date(b.startUtc),
    end: new Date(new Date(b.endUtc).getTime() + bufferMs),
  }));

  const slots: FreeSlot[] = [];
  let cursorMin = workStartMin;

  while (cursorMin + sessionDurationMinutes <= workEndMin) {
    const slotStartMin = cursorMin;
    const slotEndMin = cursorMin + sessionDurationMinutes;

    const overlapsBreak =
      breakEnabled &&
      slotStartMin < breakEndMin &&
      breakStartMin < slotEndMin;

    if (!overlapsBreak) {
      const startLabel = minutesToHHmm(slotStartMin);
      const endLabel = minutesToHHmm(slotEndMin);
      const startUtcDate = localDateTimeToUtc(dateLocal, startLabel, timezone);
      const endUtcDate = localDateTimeToUtc(dateLocal, endLabel, timezone);

      const overlapsBusy = busyRanges.some((b) =>
        rangesOverlap(startUtcDate, endUtcDate, b.start, b.end)
      );

      const tooSoon = notBefore ? startUtcDate.getTime() <= notBefore.getTime() : false;

      if (!overlapsBusy && !tooSoon) {
        slots.push({
          startUtc: startUtcDate.toISOString(),
          endUtc: endUtcDate.toISOString(),
          labelLocal: formatLocalTime(startUtcDate, timezone),
        });
      }
    }

    cursorMin += stepMinutes;
  }

  return slots;
}
