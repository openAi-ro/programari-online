/**
 * Run: npx tsx lib/referral.test.ts
 * from apps/mobile
 */
import {
  makeReferralCode,
  nextReferralStatus,
  normalizeReferralCode,
} from './referral';

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

const code = makeReferralCode(() => 0.5);
assert(/^[A-Z2-9]{6}$/.test(code), 'cod de 6 caractere fără ambiguități', code);
assert(makeReferralCode(() => 0.1) !== makeReferralCode(() => 0.9), 'generatorul variază');

assert(normalizeReferralCode(' abc-123 ') === 'ABC123', 'normalizează codul', normalizeReferralCode(' abc-123 '));
assert(normalizeReferralCode('') === '', 'gol → gol');

assert(nextReferralStatus('pending', false) === 'pending', 'fără vizită aprobată → rămâne pending');
assert(nextReferralStatus('pending', true) === 'rewarded', 'prima vizită aprobată → rewarded');
assert(nextReferralStatus('rewarded', true) === 'rewarded', 'rewarded rămâne rewarded');
assert(nextReferralStatus('rewarded', false) === 'rewarded', 'nu se întoarce la pending');

console.log(`referral: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
