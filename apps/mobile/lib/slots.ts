import type { BreakHours, FreeSlot, WorkingHours } from './types';
import {
  addOneDay,
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
/** Minutul din zi (poate trece de 1440 la turele de noapte) → instant UTC. */
function slotUtc(dateLocal: string, totalMin: number, timezone: string): Date {
  const day = totalMin >= 1440 ? addOneDay(dateLocal) : dateLocal;
  return localDateTimeToUtc(day, minutesToHHmm(totalMin % 1440), timezone);
}

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
  const rawWorkEndMin = hhmmToMinutes(dayHours.end);
  // Program peste miezul nopții (ex. 18:00–02:00): sfârșitul e a doua zi.
  const overnight = rawWorkEndMin <= workStartMin;
  const workEndMin = overnight ? rawWorkEndMin + 1440 : rawWorkEndMin;

  const breakEnabled = breakHours?.enabled === true;
  let breakStartMin = breakEnabled ? hhmmToMinutes(breakHours.start) : 0;
  let breakEndMin = breakEnabled ? hhmmToMinutes(breakHours.end) : 0;
  if (breakEnabled && overnight) {
    // Pauza se raportează la tura care trece de miezul nopții.
    if (breakStartMin < workStartMin) breakStartMin += 1440;
    if (breakEndMin <= breakStartMin) breakEndMin += 1440;
  }

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
      const startUtcDate = slotUtc(dateLocal, slotStartMin, timezone);
      const endUtcDate = slotUtc(dateLocal, slotEndMin, timezone);

      // Bufferul slotului nou nu poate intra peste programarea următoare.
      const endWithBuffer = new Date(endUtcDate.getTime() + bufferMs);
      const overlapsBusy = busyRanges.some((b) =>
        rangesOverlap(startUtcDate, endWithBuffer, b.start, b.end)
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
