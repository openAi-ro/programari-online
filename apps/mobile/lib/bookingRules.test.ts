/**
 * Run: npx tsx lib/bookingRules.test.ts
 * from apps/mobile
 */
import { firstBookableDateForStaff, firstBookableDateYmd, maxBookingDate } from './bookingRules';
import { addOneDay, formatInTimeZone } from './timezone';
import type { BusinessProfile, DayKey, Staff, WorkingHours } from './types';

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

// Data implicită urmează specialistul ales, nu primul din echipă (bug #1).
const bizHours = {
  timezone: TZ,
  working_hours: openEveryDay,
  break_hours: noBreak,
  blocked_dates: [],
  min_notice_minutes: 0,
  max_advance_days: 30,
  buffer_minutes: 0,
} as Pick<
  BusinessProfile,
  'timezone' | 'working_hours' | 'break_hours' | 'blocked_dates' | 'min_notice_minutes' | 'max_advance_days' | 'buffer_minutes'
>;
let plus3 = todayTz;
for (let i = 0; i < 3; i += 1) plus3 = addOneDay(plus3);
const dayKeys: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const plus3Key = dayKeys[new Date(`${plus3}T12:00:00Z`).getUTCDay()];
const onlyPlus3 = Object.fromEntries(
  dayKeys.map((k) => [k, k === plus3Key ? { closed: false, start: '09:00', end: '18:00' } : { closed: true }])
) as WorkingHours;
const staffLate = { id: 'late', working_hours: onlyPlus3, break_hours: noBreak } as Staff;
const staffAlways = { id: 'always', working_hours: null, break_hours: null } as unknown as Staff;
const salonFirst = firstBookableDateYmd({
  timezone: TZ,
  workingHours: openEveryDay,
  breakHours: noBreak,
  maxAdvanceDays: 30,
  sessionDurationMinutes: 60,
});
const forLate = firstBookableDateForStaff(bizHours, [staffLate], 60);
assert(forLate === plus3, 'data implicită = prima zi a specialistului ales', `expected ${plus3}, got ${forLate}`);
const forAlways = firstBookableDateForStaff(bizHours, [staffAlways], 60);
assert(forAlways === salonFirst, 'specialist fără program propriu -> programul salonului', `expected ${salonFirst}, got ${forAlways}`);
const forAnyone = firstBookableDateForStaff(bizHours, [staffLate, staffAlways], 60);
assert(forAnyone === salonFirst, 'Oricine disponibil -> cea mai devreme zi din echipă', `expected ${salonFirst}, got ${forAnyone}`);
const forNoTeam = firstBookableDateForStaff(bizHours, [], 60);
assert(forNoTeam === salonFirst, 'fără echipă -> programul salonului', `expected ${salonFirst}, got ${forNoTeam}`);

console.log(`bookingRules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
