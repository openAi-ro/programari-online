/**
 * Run: npx tsx lib/keyboardPad.test.ts
 * from apps/mobile
 */
import { computeFooterPaddingBottom } from './keyboardPad';

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
  computeFooterPaddingBottom({ base: 24, keyboardHeight: 300, platform: 'android', keyboardAvoid: true }) === 324,
  'android adună înălțimea tastaturii'
);
assert(
  computeFooterPaddingBottom({ base: 24, keyboardHeight: 0, platform: 'android', keyboardAvoid: true }) === 24,
  'tastatură ascunsă → baza'
);
assert(
  computeFooterPaddingBottom({ base: 24, keyboardHeight: 300, platform: 'ios', keyboardAvoid: true }) === 24,
  'iOS nu adună (are KAV padding)'
);
assert(
  computeFooterPaddingBottom({ base: 24, keyboardHeight: 300, platform: 'android', keyboardAvoid: false }) === 24,
  'keyboardAvoid oprit → baza'
);
assert(
  computeFooterPaddingBottom({ base: 24, keyboardHeight: -50, platform: 'android', keyboardAvoid: true }) === 24,
  'înălțime negativă ignorată'
);

console.log(`keyboardPad: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
