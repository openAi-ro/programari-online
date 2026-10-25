import { maxBookingDate, toYmd } from './bookingRules';
import { formatInTimeZone } from './timezone';
import type { AppLanguage } from './language';
import type { BusinessProfile, DayKey, WorkingHours } from './types';

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