/**
 * Run: npx tsx lib/dateInput.test.ts
 * from apps/mobile
 */
import { dateInputIssue, isCompleteYmd } from './dateInput';

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
assert(dateInputIssue('2026-10-21', '2026-10-20', '2027-01-18') === null, 'dată în interval → ok');
assert(dateInputIssue('2026-10-20', '2026-10-20', '2026-10-20') === null, 'limitele sunt incluse');
assert(dateInputIssue('', '2026-10-20', '2027-01-18') === 'incomplete', 'gol → incompletă');
assert(dateInputIssue('0202-10-21', '2026-10-20') === 'incomplete', 'an parțial → incompletă');
assert(dateInputIssue('2026-10-19', '2026-10-20', '2027-01-18') === 'outOfRange', 'în trecut → în afara perioadei');
assert(dateInputIssue('2027-10-21', '2026-10-20', '2027-01-18') === 'outOfRange', 'după max → în afara perioadei');
assert(dateInputIssue('2030-01-01') === null, 'fără limite → ok');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
