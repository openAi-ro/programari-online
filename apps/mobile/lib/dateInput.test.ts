/**
 * Run: npx tsx lib/dateInput.test.ts
 * from apps/mobile
 */
import { isCompleteYmd } from './dateInput';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.error(`  FAIL  ${name}`); }
}
console.log('dateInput tests\n');
assert(isCompleteYmd('2026-10-22'), 'data completă validă');
assert(!isCompleteYmd('0002-10-22'), 'an parțial 0002 respins');
assert(!isCompleteYmd('0202-10-22'), 'an parțial 0202 respins');
assert(!isCompleteYmd('0000-10-22'), 'an 0000 respins');
assert(!isCompleteYmd(''), 'gol respins');
assert(!isCompleteYmd('2026-02-30'), '30 februarie respins');
assert(isCompleteYmd('2028-02-29'), '29 februarie în an bisect acceptat');
assert(!isCompleteYmd('2026-13-01'), 'luna 13 respinsă');
assert(!isCompleteYmd('20261-01-01'), 'an cu 5 cifre respins');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
