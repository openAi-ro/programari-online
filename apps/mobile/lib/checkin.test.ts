/**
 * Run: npx tsx lib/checkin.test.ts
 * from apps/mobile
 */
import { canConfirmAttendance } from './bookingRules';
import { canCheckIn } from './checkin';

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

const now = new Date('2026-10-18T10:00:00Z');

assert(
  canCheckIn({ status: 'approved', startAt: '2026-10-18T10:20:00Z', checkedInAt: null }, now) === true,
  'programare aprobată de azi, în 20 min → se poate anunța sosirea',
);
assert(
  canCheckIn({ status: 'approved', startAt: '2026-10-18T10:20:00Z', checkedInAt: '2026-10-18T09:50:00Z' }, now) === false,
  'deja anunțat → nu din nou',
);
assert(
  canCheckIn({ status: 'pending', startAt: '2026-10-18T10:20:00Z', checkedInAt: null }, now) === false,
  'cerere neaprobată → nu',
);
assert(
  canCheckIn({ status: 'approved', startAt: '2026-10-19T10:00:00Z', checkedInAt: null }, now) === false,
  'mâine → prea devreme',
);
assert(
  canCheckIn({ status: 'approved', startAt: '2026-10-18T04:00:00Z', checkedInAt: null }, now) === false,
  'trecută de 4 ore → prea târziu',
);
assert(
  canCheckIn({ status: 'cancelled', startAt: '2026-10-18T10:20:00Z', checkedInAt: null }, now) === false,
  'anulată → nu',
);

const apt = (startAt: string) => ({ status: 'approved' as const, start_at: startAt, attendance_confirmed: false, no_show: false });
for (const [startAt, confirm, checkIn, label] of [
  ['2026-10-25T10:00:00Z', true, false, 'peste o săptămână → doar „Confirmă că ajung”'],
  ['2026-10-18T11:01:00Z', true, false, 'peste 61 min → doar „Confirmă că ajung”'],
  ['2026-10-18T11:00:00Z', false, true, 'exact 60 min → doar „Am ajuns”'],
  ['2026-10-18T10:10:00Z', false, true, 'peste 10 min → doar „Am ajuns”'],
] as const) {
  assert(canConfirmAttendance(apt(startAt), now) === confirm && canCheckIn({ status: 'approved', startAt, checkedInAt: null }, now) === checkIn, label);
}

console.log(`checkin: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
