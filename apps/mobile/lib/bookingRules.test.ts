/**
 * Run: npx tsx lib/bookingRules.test.ts
 * from apps/mobile
 */
import { firstBookableDateYmd, maxBookingDate } from './bookingRules';
import { addOneDay, formatInTimeZone } from './timezone';
import type { WorkingHours } from './types';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const TZ = 'Europe/Bucharest';
const openEveryDay: WorkingHours = {
  mon: { closed: false, start: '09:00', end: '18:00' },
  tue: { closed: false, start: '09:00', end: '18:00' },
  wed: { closed: false, start: '09:00', end: '18:00' },
  thu: { closed: false, start: '09:00', end: '18:00' },
  fri: { closed: false, start: '09:00', end: '18:00' },
  sat: { closed: false, start: '09:00', end: '18:00' },
  sun: { closed: false, start: '09:00', end: '18:00' },
};
const noBreak = { enabled: false, start: '13:00', end: '14:00' };

const todayTz = formatInTimeZone(new Date(), TZ, 'yyyy-MM-dd');

// Următoarele 30 de zile blocate: prima zi liberă e azi+31 în fusul firmei,
// dincolo de vechea limită de căutare de 21 de zile.
const blocked: string[] = [];
let cursor = todayTz;
for (let i = 0; i < 30; i += 1) {
  blocked.push(cursor);
  cursor = addOneDay(cursor);
}
const expected = cursor;

const found = firstBookableDateYmd({
  timezone: TZ,
  workingHours: openEveryDay,
  breakHours: noBreak,
  blockedDates: blocked,
  sessionDurationMinutes: 60,
  // Preaviz mare, ca ziua de azi să nu conteze prin sloturi de azi,
  // ci doar prin zilele blocate.
  minNoticeMinutes: 0,
  maxAdvanceDays: 90,
});
assert(found === expected, 'prima zi liberă după 30 de zile blocate (peste limita veche de 21)', `expected ${expected}, got ${found}`);

// Totul blocat în fereastra de avans → azi în fusul firmei, nu în fusul telefonului.
const blockedAll: string[] = [];
cursor = todayTz;
for (let i = 0; i < 90; i += 1) {
  blockedAll.push(cursor);
  cursor = addOneDay(cursor);
}
const fallback = firstBookableDateYmd({
  timezone: TZ,
  workingHours: openEveryDay,
  breakHours: noBreak,
  blockedDates: blockedAll,
  sessionDurationMinutes: 60,
  maxAdvanceDays: 90,
});
assert(fallback === todayTz, 'fără nicio zi liberă → azi în fusul firmei', `expected ${todayTz}, got ${fallback}`);

// Data maximă: azi + max_advance_days pe calendarul firmei.
const maxD = maxBookingDate({ max_advance_days: 10, timezone: TZ });
let expectedMax = todayTz;
for (let i = 0; i < 10; i += 1) expectedMax = addOneDay(expectedMax);
assert(
  formatInTimeZone(maxD, TZ, 'yyyy-MM-dd') === expectedMax,
  'maxBookingDate numără zilele pe calendarul firmei',
  `expected ${expectedMax}, got ${formatInTimeZone(maxD, TZ, 'yyyy-MM-dd')}`,
);

console.log(`bookingRules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
