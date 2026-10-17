/**
 * Run: npx tsx lib/rebook.test.ts
 * from apps/mobile
 */
import { isRebookDue, rebookDueDate } from './rebook';

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

const now = new Date('2026-10-18T12:00:00Z');

assert(rebookDueDate('2026-09-18T12:00:00Z', 30) === '2026-10-18', 'scadenta la 30 zile', rebookDueDate('2026-09-18T12:00:00Z', 30) ?? '');
assert(rebookDueDate('2026-09-18T12:00:00Z', 0) === null, 'interval 0 → oprit');
assert(rebookDueDate('2026-09-18T12:00:00Z', -5) === null, 'interval negativ → oprit');
assert(rebookDueDate(null, 30) === null, 'fără vizită → null');
assert(rebookDueDate('nu-e-data', 30) === null, 'dată invalidă → null');

assert(
  isRebookDue({ lastVisitAt: '2026-09-15T12:00:00Z', intervalDays: 30, hasUpcoming: false }, now) === true,
  'vizită veche de 33 zile, interval 30 → scadent',
);
assert(
  isRebookDue({ lastVisitAt: '2026-10-10T12:00:00Z', intervalDays: 30, hasUpcoming: false }, now) === false,
  'vizită recentă → nu e scadent',
);
assert(
  isRebookDue({ lastVisitAt: '2026-09-01T12:00:00Z', intervalDays: 30, hasUpcoming: true }, now) === false,
  'are programare viitoare → nu trimite',
);
assert(
  isRebookDue({ lastVisitAt: null, intervalDays: 30, hasUpcoming: false }, now) === false,
  'fără vizită → nu trimite',
);
assert(
  isRebookDue({ lastVisitAt: '2026-09-01T12:00:00Z', intervalDays: 0, hasUpcoming: false }, now) === false,
  'interval oprit → nu trimite',
);

console.log(`rebook: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
