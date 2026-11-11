import { maxBookingDate, toYmd } from './bookingRules';
import { generateFreeSlots, type BusyRange } from './slots';
import { formatInTimeZone, localDateTimeToUtc, localDayBoundsUtc } from './timezone';
import type { AppLanguage } from './language';
import type { TrKey } from './i18n';
import { roDe } from './roNumber';
import type { BreakHours, BusinessProfile, DayKey, WorkingHours } from './types';

/** Săptămâna începe luni. */
export const CALENDAR_WEEKDAYS_RO = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du'] as const;
export const CALENDAR_MONTHS_RO = [
  'Ianuarie',
  'Februarie',
  'Martie',
  'Aprilie',
  'Mai',
  'Iunie',
  'Iulie',
  'August',
  'Septembrie',
  'Octombrie',
  'Noiembrie',
  'Decembrie',
] as const;

export const CALENDAR_WEEKDAYS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
export const CALENDAR_MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Numele zilelor (luni primul) și lunilor pentru calendar, în limba aplicației. */
export function calendarNames(lang: AppLanguage): {
  weekdays: readonly string[];
  months: readonly string[];
} {
  return lang === 'en'
    ? { weekdays: CALENDAR_WEEKDAYS_EN, months: CALENDAR_MONTHS_EN }
    : { weekdays: CALENDAR_WEEKDAYS_RO, months: CALENDAR_MONTHS_RO };
}

const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** O lună de calendar: an + luna 0..11. */
export type CalendarMonth = { year: number; month: number };

/** "YYYY-MM-DD" din an/lună(0..11)/zi, fără conversii de fus. */
export function ymdOf(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function monthOfYmd(ymd: string): CalendarMonth {
  const [y, m] = ymd.split('-').map(Number);
  return { year: y, month: m - 1 };
}

export function addMonths(m: CalendarMonth, delta: number): CalendarMonth {
  const total = m.year * 12 + m.month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

function monthIndex(m: CalendarMonth): number {
  return m.year * 12 + m.month;
}

/** Ziua săptămânii pentru o dată de calendar (constructor local, fără UTC). */
export function dayKeyOfYmd(ymd: string): DayKey {
  const [y, m, d] = ymd.split('-').map(Number);
  return DAY_KEYS[new Date(y, m - 1, d).getDay()];
}

/**
 * Grila lunii, pe rânduri de câte 7 (luni..duminică). `null` = căsuță goală
 * înainte de 1 sau după ultima zi.
 */
export function monthGrid(m: CalendarMonth): (string | null)[][] {
  const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
  const lead = (new Date(m.year, m.month, 1).getDay() + 6) % 7; // luni = 0
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(ymdOf(m.year, m.month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** Intervalul rezervabil: azi (în fusul firmei) .. azi + max_advance_days (implicit 90). */
export function bookingDateRange(
  business: Pick<BusinessProfile, 'max_advance_days' | 'timezone'>,
  now: Date = new Date()
): { minYmd: string; maxYmd: string } {
  const minYmd = business.timezone
    ? formatInTimeZone(now, business.timezone, 'yyyy-MM-dd')
    : toYmd(now);
  return { minYmd, maxYmd: toYmd(maxBookingDate(business)) };
}

/**
 * Zi deschisă dacă măcar unul dintre programe lucrează în ziua respectivă.
 * Programul peste noapte (ex. 22:00–02:00) contează ca deschis în ziua în care începe.
 */
export function isOpenOnDay(ymd: string, schedules: readonly WorkingHours[]): boolean {
  const key = dayKeyOfYmd(ymd);
  return schedules.some((wh) => {
    const day = wh?.[key];
    return !!day && day.closed === false && !!day.start && !!day.end;
  });
}

export type CalendarRules = {
  minYmd: string;
  maxYmd: string;
  blockedDates: readonly string[];
  /** Programul firmei sau al specialistului ales; la „Oricine”, programele tuturor. */
  schedules: readonly WorkingHours[];
};

/** Gri și neapăsabil: trecut, peste limită, zi blocată sau zi închisă. */
export function isDayDisabled(ymd: string, rules: CalendarRules): boolean {
  if (ymd < rules.minYmd || ymd > rules.maxYmd) return true;
  if (rules.blockedDates.includes(ymd)) return true;
  return !isOpenOnDay(ymd, rules.schedules);
}

/** Săgeata „înapoi” e activă doar după luna curentă. */
export function canGoPrevMonth(view: CalendarMonth, minYmd: string): boolean {
  return monthIndex(view) > monthIndex(monthOfYmd(minYmd));
}

/** Săgeata „înainte” e activă doar până la luna limitei. */
export function canGoNextMonth(view: CalendarMonth, maxYmd: string): boolean {
  return monthIndex(view) < monthIndex(monthOfYmd(maxYmd));
}

// ---------------------------------------------------------------------------
// Culorile zilelor (varianta A): cât de plină e ziua.

/** Tonul unei zile: liberă, medie, aproape plină, plină, închisă. Clientul vede doar free/almostFull/full. */
export type DayTone = 'free' | 'moderate' | 'almostFull' | 'full' | 'closed';

/**
 * Pragurile de ocupare pentru business (minute ocupate / minute de lucru).
 * Ales cu TypeSafe/Jev (jev-1.14.0, 2026-11-10): 40% / 75% / 95%, p=0.55 față de 25/50/80 și 50/85/100.
 */
export const OCCUPANCY_BANDS = { moderate: 0.4, almostFull: 0.75, full: 0.95 } as const;

/**
 * „Puține locuri” pentru client, relativ la durata serviciului ales: cel mult 2 ore de început
 * rămase sau cel mult 25% din orele posibile ale zilei (TypeSafe/Jev, 2026-11-10, p=0.74).
 */
export const FEW_LEFT = { maxCount: 2, maxShare: 0.25 } as const;

export function occupancyTone(ratio: number | null): DayTone {
  if (ratio === null || !Number.isFinite(ratio)) return 'closed';
  if (ratio >= OCCUPANCY_BANDS.full) return 'full';
  if (ratio >= OCCUPANCY_BANDS.almostFull) return 'almostFull';
  if (ratio >= OCCUPANCY_BANDS.moderate) return 'moderate';
  return 'free';
}

/** Disponibilitatea pentru client: câte ore de început mai sunt libere din câte ar avea ziua. */
export function availabilityTone(freeCount: number, possibleCount: number): DayTone {
  if (possibleCount <= 0) return 'closed';
  if (freeCount <= 0) return 'full';
  if (freeCount <= FEW_LEFT.maxCount || freeCount / possibleCount <= FEW_LEFT.maxShare) return 'almostFull';
  return 'free';
}

/** Programul unui specialist (sau al firmei fără echipă). */
export type DayCapacity = { workingHours: WorkingHours; breakHours?: BreakHours | null };

function hhmm(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Fereastra de lucru dintr-o zi (instant UTC, ms) și minutele de pauză din ea; null = nu lucrează. */
function shiftWindow(ymd: string, timezone: string, cap: DayCapacity): { startMs: number; endMs: number; workMs: number } | null {
  const day = cap.workingHours?.[dayKeyOfYmd(ymd)];
  if (!day || day.closed !== false || !day.start || !day.end) return null;
  const s = hhmm(day.start);
  let e = hhmm(day.end);
  if (e <= s) e += 1440; // tura peste miezul nopții
  let breakMin = 0;
  const br = cap.breakHours;
  if (br?.enabled && br.start && br.end) {
    let bs = hhmm(br.start);
    let be = hhmm(br.end);
    if (e > 1440 && bs < s) bs += 1440;
    if (be <= bs) be += 1440;
    breakMin = Math.max(0, Math.min(be, e) - Math.max(bs, s));
  }
  const startMs = localDateTimeToUtc(ymd, day.start, timezone).getTime();
  const endMs = startMs + (e - s) * 60_000;
  return { startMs, endMs, workMs: Math.max(0, (e - s - breakMin) * 60_000) };
}

/** Intervalele care se suprapun devin unul (un singur program nu poate fi ocupat de două ori). */
function mergeRanges(ranges: { s: number; e: number }[]): { s: number; e: number }[] {
  const sorted = [...ranges].sort((a, b) => a.s - b.s);
  const out: { s: number; e: number }[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.s <= last.e) last.e = Math.max(last.e, r.e);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Ocuparea unei zile: minute ocupate / minute de lucru (fără pauze), între 0 și 1.
 * Ocupat = programări (și orele ținute de o cerere de mutare), Google Calendar și concedii,
 * tăiate la fereastra de lucru a zilei. Cu mai mulți specialiști se adună capacitățile.
 * null = zi închisă (blocată sau nimeni nu lucrează).
 */
export function dayOccupancy(
  ymd: string,
  timezone: string,
  capacities: readonly DayCapacity[],
  busy: readonly BusyRange[],
  blockedDates: readonly string[] = []
): number | null {
  if (blockedDates.includes(ymd)) return null;
  const windows = capacities.map((c) => shiftWindow(ymd, timezone, c)).filter((w): w is NonNullable<typeof w> => !!w);
  const capacityMs = windows.reduce((sum, w) => sum + w.workMs, 0);
  if (windows.length === 0 || capacityMs <= 0) return null;
  const winStart = Math.min(...windows.map((w) => w.startMs));
  const winEnd = Math.max(...windows.map((w) => w.endMs));
  let clipped = busy
    .map((b) => ({ s: Math.max(new Date(b.startUtc).getTime(), winStart), e: Math.min(new Date(b.endUtc).getTime(), winEnd) }))
    .filter((r) => r.e > r.s);
  if (windows.length === 1) clipped = mergeRanges(clipped);
  const busyMs = clipped.reduce((sum, r) => sum + (r.e - r.s), 0);
  return Math.min(1, busyMs / capacityMs);
}

/** Toate zilele lunii, "YYYY-MM-DD". */
export function monthDays(m: CalendarMonth): string[] {
  const n = new Date(m.year, m.month + 1, 0).getDate();
  return Array.from({ length: n }, (_, i) => ymdOf(m.year, m.month, i + 1));
}

/** Intervalul UTC al lunii în fusul firmei, pentru o singură cerere pe lună. */
export function monthBoundsUtc(m: CalendarMonth, timezone: string): { fromIso: string; toIso: string } {
  const days = monthDays(m);
  return {
    fromIso: localDayBoundsUtc(days[0]!, timezone).startUtc.toISOString(),
    toIso: localDayBoundsUtc(days[days.length - 1]!, timezone).endUtc.toISOString(),
  };
}

/**
 * Specialiștii pentru cifra de pe zi: null = toată firma (fără echipă / toți),
 * altfel id-urile calendarului (programările fără specialist se numără la fiecare, v85).
 */
export function countStaffIds(staffIds: readonly (string | null)[]): string[] | null {
  if (staffIds.length === 0 || staffIds.some((id) => !id)) return null;
  return [...new Set(staffIds as string[])];
}

/** Business: tonul fiecărei zile din lună după ocupare. */
export function businessMonthTones(opts: {
  month: CalendarMonth;
  timezone: string;
  capacities: readonly DayCapacity[];
  busy: readonly BusyRange[];
  blockedDates?: readonly string[];
}): Record<string, DayTone> {
  const out: Record<string, DayTone> = {};
  for (const ymd of monthDays(opts.month)) {
    out[ymd] = occupancyTone(dayOccupancy(ymd, opts.timezone, opts.capacities, opts.busy, opts.blockedDates ?? []));
  }
  return out;
}

/**
 * Client: tonul fiecărei zile rezervabile, din orele libere pentru durata aleasă
 * (aceeași funcție ca lista de ore, deci culoarea și lista nu se contrazic).
 */
/** Programul și ocupările unui specialist (sau ale firmei fără echipă), pentru tonurile clientului. */
export type ClientCapacity = { workingHours: WorkingHours; breakHours: BreakHours; busy: BusyRange[] };

/**
 * Tonul fiecărei zile pentru client. Cu mai mulți specialiști („Oricine”) se adună orele de start
 * libere și posibile ale tuturor: o zi e liberă dacă măcar unul are loc, plină dacă niciunul.
 */
export function clientMonthTones(opts: {
  month: CalendarMonth;
  timezone: string;
  members: ClientCapacity[];
  durationMinutes: number;
  bufferMinutes?: number;
  blockedDates?: string[];
  notBeforeUtc?: Date;
  minYmd: string;
  maxYmd: string;
}): Record<string, DayTone> {
  const out: Record<string, DayTone> = {};
  const base = {
    timezone: opts.timezone,
    sessionDurationMinutes: opts.durationMinutes,
    bufferMinutes: opts.bufferMinutes ?? 0,
    blockedDates: opts.blockedDates ?? [],
    notBeforeUtc: opts.notBeforeUtc,
  };
  for (const ymd of monthDays(opts.month)) {
    if (ymd < opts.minYmd || ymd > opts.maxYmd) continue;
    let possible = 0;
    let free = 0;
    for (const m of opts.members) {
      const day = { ...base, dateLocal: ymd, workingHours: m.workingHours, breakHours: m.breakHours };
      const can = generateFreeSlots({ ...day, busy: [] }).length;
      if (can === 0) continue;
      possible += can;
      free += generateFreeSlots({ ...day, busy: m.busy }).length;
    }
    out[ymd] = availabilityTone(free, possible);
  }
  return out;
}

/** Eticheta tonului unei zile din calendar (legendă + cititor de ecran). */
export function dayToneLabelKey(tone: DayTone, business: boolean): TrKey {
  if (tone === 'free') return business ? 'calendar.toneFree' : 'calendar.toneAvailable';
  if (tone === 'moderate') return 'calendar.toneModerate';
  if (tone === 'almostFull') return business ? 'calendar.toneAlmostFull' : 'calendar.toneFewLeft';
  if (tone === 'full') return 'calendar.toneFull';
  return 'calendar.toneClosed';
}

/** „1 programare”, „5 programări”, „20 de programări” pentru cititorul de ecran. */
export function dayCountA11y(
  count: number,
  lang: AppLanguage,
  tr: (key: TrKey, params?: Record<string, string | number>) => string,
): string {
  if (count === 1) return tr('calendar.countA11yOne');
  return tr('calendar.countA11y', { n: count, de: lang === 'ro' ? roDe(count) : '' });
}
