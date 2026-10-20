/**
 * Run: npx tsx lib/keyboardInset.test.ts
 * from apps/mobile
 */
import { keyboardOverlap } from './keyboardInset';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.error(`  FAIL  ${name}`); }
}
console.log('keyboardInset tests\n');
assert(keyboardOverlap(844, 844, 0) === 0, 'fără tastatură → 0');
assert(keyboardOverlap(844, 500, 0) === 344, 'tastatura acoperă 344px');
assert(keyboardOverlap(844, 500, 100) === 244, 'viewport derulat: scade offsetTop');
assert(keyboardOverlap(844, 900, 0) === 0, 'niciodată negativ');
assert(keyboardOverlap(0, 500, 0) === 0, 'înălțime necunoscută → 0');
assert(keyboardOverlap(844, 500.4, 0) === 344, 'rotunjit');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
