/**
 * Run: npx tsx lib/packages.test.ts
 * from apps/mobile
 */
import { applySessionUse, isPackageExhausted, sessionsLeft } from './packages';

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

assert(sessionsLeft(10, 3) === 7, '10 total, 3 folosite → 7 rămase');
assert(sessionsLeft(10, 10) === 0, 'epuizat → 0');
assert(sessionsLeft(10, 12) === 0, 'peste total → 0, fără negativ');
assert(sessionsLeft(0, 0) === 0, 'pachet gol → 0');

assert(isPackageExhausted(10, 10) === true, '10/10 → epuizat');
assert(isPackageExhausted(10, 9) === false, '9/10 → activ');
assert(isPackageExhausted(0, 0) === true, '0 ședințe → epuizat');

assert(applySessionUse(10, 3, 1) === 4, 'folosește o ședință');
assert(applySessionUse(10, 3, -1) === 2, 'dă înapoi o ședință');
assert(applySessionUse(10, 10, 1) === null, 'nu poate depăși totalul');
assert(applySessionUse(10, 0, -1) === null, 'nu poate scădea sub zero');
assert(applySessionUse(10, 3, 0) === null, 'delta zero → invalid');

console.log(`packages: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
