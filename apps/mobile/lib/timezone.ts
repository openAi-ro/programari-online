import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

import type { DayKey } from './types';

const ISO_DOW_TO_DAY: Record<string, DayKey> = {
  '1': 'mon',
  '2': 'tue',
  '3': 'wed',
  '4': 'thu',
  '5': 'fri',
  '6': 'sat',
  '7': 'sun',
};

/** Day key (mon..sun) for a local calendar date in a timezone. */
export function dayKeyForDateLocal(dateLocal: string, timezone: string): DayKey {
  // noon avoids DST edge cases at midnight
  const utc = fromZonedTime(`${dateLocal}T12:00:00`, timezone);
  const isoDow = formatInTimeZone(utc, timezone, 'i'); // 1=Mon .. 7=Sun
  return ISO_DOW_TO_DAY[isoDow] ?? 'mon';
}

/** Parse YYYY-MM-DD + HH:mm as local wall time in timezone → UTC Date. */
export function localDateTimeToUtc(
  dateLocal: string,
  timeHHmm: string,
  timezone: string
): Date {
  const normalized = timeHHmm.length === 5 ? `${timeHHmm}:00` : timeHHmm;
  return fromZonedTime(`${dateLocal}T${normalized}`, timezone);
}

/** Format a UTC instant as HH:mm in the given timezone. */
export function formatLocalTime(utc: Date | string, timezone: string): string {
  const d = typeof utc === 'string' ? new Date(utc) : utc;
  return formatInTimeZone(d, timezone, 'HH:mm');
}

export function addOneDay(dateLocal: string): string {
  const [y, m, d] = dateLocal.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Start (inclusive) and end (exclusive) of a local calendar day as UTC Dates. */
export function localDayBoundsUtc(
  dateLocal: string,
  timezone: string
): { startUtc: Date; endUtc: Date } {
  const startUtc = fromZonedTime(`${dateLocal}T00:00:00`, timezone);
  const endUtc = fromZonedTime(`${addOneDay(dateLocal)}T00:00:00`, timezone);
  return { startUtc, endUtc };
}

/** Verifică dacă un nume de fus orar e un identificator IANA valid. */
export function isValidTimeZone(timezone: string): boolean {
  if (!timezone || typeof timezone !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export { formatInTimeZone, fromZonedTime, toZonedTime };
