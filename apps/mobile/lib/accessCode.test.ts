/**
 * Run: npx tsx lib/accessCode.test.ts
 * from apps/mobile
 */
import {
  ACCESS_CODE_ALPHABET,
  expiryError,
  formatAccessCode,
  isCompleteAccessCode,
  normalizeAccessCode,
  parseCustomExpiry,
  parseMaxUses,
  presetExpiry,
} from './accessCode';
import { specializationError } from './specialization';
import { matchesBusinessQuery } from './browseList';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('accessCode');
assert(normalizeAccessCode(' ab3k-9x2c zh9r ') === 'AB3K9X2CZH9R', 'normalize strips separators + uppercases');
assert(formatAccessCode('ab3k9x2czh9r') === 'AB3K-9X2C-ZH9R', 'format groups of 4');
assert(formatAccessCode('ab3k9') === 'AB3K-9', 'format partial while typing');
assert(formatAccessCode('ab3k9x2czh9rEXTRA') === 'AB3K-9X2C-ZH9R', 'format caps at 12');
assert(isCompleteAccessCode('AB3K-9X2C-ZH9R'), 'complete code');
assert(!isCompleteAccessCode('AB3K-9X2C'), 'incomplete code');
assert(!/[01OIL]/.test(ACCESS_CODE_ALPHABET) && ACCESS_CODE_ALPHABET.length === 31, 'alphabet unambiguous, 31 chars');

const now = new Date(2026, 9, 28, 12, 0);
assert(presetExpiry('24h', now).getTime() - now.getTime() === 86_400_000, 'preset 24h');
assert(expiryError(presetExpiry('30d', now), now) === null, 'preset 30d valid');
assert(expiryError(new Date(now.getTime() + 60_000), now) === 'tooSoon', '1 min too soon');
assert(expiryError(new Date(now.getTime() + 400 * 86_400_000), now) === 'tooLate', '400 days too late');
assert(expiryError(null, now) === 'format', 'null → format');

const c = parseCustomExpiry('05.11.2026 18:30');
assert(c != null && c.getDate() === 5 && c.getMonth() === 10 && c.getHours() === 18 && c.getMinutes() === 30, 'custom date+time');
const d = parseCustomExpiry('05.11.2026');
assert(d != null && d.getHours() === 23 && d.getMinutes() === 59, 'custom date only → 23:59');
assert(parseCustomExpiry('31.02.2026') === null, 'impossible date rejected');
assert(parseCustomExpiry('2026-11-05') === null, 'wrong format rejected');
assert(parseCustomExpiry('05.11.2026 25:00') === null, 'bad hour rejected');

assert(parseMaxUses('1') === 1 && parseMaxUses('1000') === 1000, 'uses bounds ok');
assert(parseMaxUses('0') === null && parseMaxUses('1001') === null && parseMaxUses('2.5') === null, 'uses invalid');

console.log('general category');
assert(specializationError('  ') === 'empty', 'empty specialization');
assert(specializationError('  a  ') === 'tooShort', '1 char too short');
assert(specializationError('Croitorie') === null, 'valid specialization');
assert(specializationError('x'.repeat(41)) === 'tooLong', '41 chars too long');
const biz = { name: 'Atelier Ana', public_code: 'abc123', specialization: 'Croitorie' };
assert(matchesBusinessQuery(biz, 'croit'), 'search matches specialization');
assert(matchesBusinessQuery(biz, 'ATELIER'), 'search matches name');
assert(!matchesBusinessQuery({ ...biz, specialization: null }, 'croit'), 'no specialization → no match');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
