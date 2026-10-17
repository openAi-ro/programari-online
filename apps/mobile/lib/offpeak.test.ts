/**
 * Run: npx tsx lib/offpeak.test.ts
 * from apps/mobile
 */
import { discountedPrice, isOffpeakStart } from './offpeak';

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

assert(
  isOffpeakStart('2026-10-19T08:00:00Z', 'Europe/Bucharest', 10, 14) === true,
  '11:00 Bucuresti în 10-14 → off-peak',
);
assert(
  isOffpeakStart('2026-10-19T12:00:00Z', 'Europe/Bucharest', 10, 14) === false,
  '15:00 Bucuresti în afara 10-14 → nu',
);
assert(
  isOffpeakStart('2026-10-19T20:00:00Z', 'Europe/Bucharest', 22, 2) === true,
  'fereastră peste miezul nopții: 23:00 în 22-02 → da',
);
assert(
  isOffpeakStart('2026-10-19T10:00:00Z', 'Europe/Bucharest', 22, 2) === false,
  'fereastră peste miezul nopții: 13:00 → nu',
);
assert(
  isOffpeakStart('2026-10-19T08:00:00Z', 'Europe/Bucharest', null, 14) === false,
  'setări lipsă → oprit',
);
assert(
  isOffpeakStart('2026-10-19T08:00:00Z', 'Europe/Bucharest', 10, 14, 0) === false,
  'reducere 0 → oprit',
);
assert(
  isOffpeakStart('nu-e-data', 'Europe/Bucharest', 10, 14, 10) === false,
  'dată invalidă → nu',
);

assert(discountedPrice(100, 10) === 90, '100 − 10% → 90', String(discountedPrice(100, 10)));
assert(discountedPrice(99, 10) === 89.1, 'rotunjire la 2 zecimale', String(discountedPrice(99, 10)));
assert(discountedPrice(100, 0) === 100, '0% → neschimbat');
assert(discountedPrice(100, 95) === 10, 'plafon 90%: 95% → tot 10% din preț');

console.log(`offpeak: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
