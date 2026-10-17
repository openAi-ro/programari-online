/**
 * Run: npx tsx lib/giftCard.test.ts
 * from apps/mobile
 */
import {
  applyGiftRedemption,
  formatGiftCode,
  isValidGiftAmount,
  normalizeGiftCode,
} from './giftCard';

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

assert(formatGiftCode('abcd1234efgh5678') === 'ABCD-1234-EFGH-5678', 'cod grupat 4-4-4-4', formatGiftCode('abcd1234efgh5678'));
assert(formatGiftCode('') === '', 'gol → gol');
assert(normalizeGiftCode(' abcd-1234 ') === 'ABCD1234', 'normalizează codul scris de client', normalizeGiftCode(' abcd-1234 '));
assert(normalizeGiftCode('ABCD-1234') === normalizeGiftCode('abcd1234'), 'cu și fără cratime → același cod');

assert(isValidGiftAmount(100) === true, '100 lei valid');
assert(isValidGiftAmount(0) === false, '0 invalid');
assert(isValidGiftAmount(-5) === false, 'negativ invalid');
assert(isValidGiftAmount(Number.NaN) === false, 'NaN invalid');

assert(applyGiftRedemption(200, 50) === 150, 'folosește 50 din 200');
assert(applyGiftRedemption(200, 200) === 0, 'folosește tot');
assert(applyGiftRedemption(200, 250) === null, 'nu poate folosi peste sold');
assert(applyGiftRedemption(200, 0) === null, 'zero invalid');
assert(applyGiftRedemption(0, 10) === null, 'sold gol → invalid');

console.log(`giftCard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
