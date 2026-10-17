/**
 * Run: npx tsx lib/waitlistFilter.test.ts
 * from apps/mobile
 */
import { filterWaitlistByDate, waitlistDates } from './waitlistFilter';

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

const rows = [
  { id: '1', desired_date: '2026-10-20' },
  { id: '2', desired_date: '2026-10-19' },
  { id: '3', desired_date: '2026-10-20' },
  { id: '4', desired_date: '2026-10-19' },
];

const dates = waitlistDates(rows);
assert(
  dates.length === 2 && dates[0] === '2026-10-19' && dates[1] === '2026-10-20',
  'zile unice, sortate crescător',
  dates.join(','),
);
assert(waitlistDates([]).length === 0, 'fără rânduri → fără zile');

const all = filterWaitlistByDate(rows, null);
assert(all.length === 4, 'filtru null → toate rândurile', String(all.length));

const day = filterWaitlistByDate(rows, '2026-10-20');
assert(
  day.length === 2 && day.every((r) => r.desired_date === '2026-10-20'),
  'filtrul păstrează doar ziua aleasă',
  day.map((r) => r.id).join(','),
);
assert(filterWaitlistByDate(rows, '2026-12-25').length === 0, 'zi fără înscrieri → gol');

console.log(`waitlistFilter: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
