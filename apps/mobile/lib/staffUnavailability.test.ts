/**
 * Run: npx tsx lib/staffUnavailability.test.ts
 * from apps/mobile
 */
import {
  unavailabilityCoversDate,
  unavailabilityOverlapsRange,
  validateUnavailabilityRange,
  type StaffUnavailabilityRange,
} from './staffUnavailabilityRules';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.error(`  FAIL  ${name}`); }
}

console.log('staffUnavailability tests\n');

const row: StaffUnavailabilityRange = {
  start_date: '2026-11-02',
  end_date: '2026-11-06',
};

assert(unavailabilityCoversDate(row, '2026-11-02'), 'acopera prima zi');
assert(unavailabilityCoversDate(row, '2026-11-06'), 'acopera ultima zi');
assert(!unavailabilityCoversDate(row, '2026-11-07'), 'nu acopera dupa interval');
assert(!unavailabilityCoversDate(row, '2026-11-01'), 'nu acopera inainte de interval');
assert(unavailabilityOverlapsRange(row, '2026-11-06', '2026-11-08'), 'suprapunere la margine inclusa');
assert(!unavailabilityOverlapsRange(row, '2026-11-07', '2026-11-08'), 'fara suprapunere dupa');
assert(validateUnavailabilityRange('2026-11-02', '2026-11-06') === null, 'interval valid');
assert(validateUnavailabilityRange('2026-11-06', '2026-11-02') === 'unavailability_range_invalid', 'sfarsit inainte de inceput respins');
assert(validateUnavailabilityRange('', '2026-11-02') === 'unavailability_range_invalid', 'data lipsa respinsa');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
