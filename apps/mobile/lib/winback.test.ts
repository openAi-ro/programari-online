/**
 * Run: npx tsx lib/winback.test.ts
 * from apps/mobile
 */
import { daysSinceLastVisit, isWinbackCandidate } from './winback';

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
const old = '2026-08-01T12:00:00Z';
const recent = '2026-10-10T12:00:00Z';

assert(daysSinceLastVisit(old, now) === 78, 'zile de la ultima vizită', String(daysSinceLastVisit(old, now)));
assert(daysSinceLastVisit(null, now) === null, 'fără vizită → null');
assert(daysSinceLastVisit('nu-e-data', now) === null, 'dată invalidă → null');

assert(
  isWinbackCandidate({ visit_count: 3, last_start_at: old, upcoming_count: 0 }, now) === true,
  'client vechi, fără programare viitoare → candidat',
);
assert(
  isWinbackCandidate({ visit_count: 3, last_start_at: recent, upcoming_count: 0 }, now) === false,
  'vizită recentă → nu e candidat',
);
assert(
  isWinbackCandidate({ visit_count: 3, last_start_at: old, upcoming_count: 1 }, now) === false,
  'are programare viitoare → nu e candidat',
);
assert(
  isWinbackCandidate({ visit_count: 0, last_start_at: null, upcoming_count: 0 }, now) === false,
  'fără nicio vizită → nu e candidat',
);
assert(
  isWinbackCandidate({ visit_count: 1, last_start_at: old, upcoming_count: 0 }, now, 90) === false,
  'prag 90 zile: 78 zile nu ajunge',
);
assert(
  isWinbackCandidate({ visit_count: 1, last_start_at: old, upcoming_count: 0 }, now, 30) === true,
  'prag 30 zile: 78 zile trece',
);

console.log(`winback: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
