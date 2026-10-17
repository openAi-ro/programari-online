/**
 * Run: npx tsx lib/checkin.test.ts
 * from apps/mobile
 */
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

console.log(`checkin: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
