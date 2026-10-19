/**
 * Run: npx tsx lib/timezone-rules.test.ts
 * from apps/mobile
 */
import { isValidTimeZone } from './timezone';

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

assert(isValidTimeZone('Europe/Bucharest') === true, 'IANA valid acceptat');
assert(isValidTimeZone('America/New_York') === true, 'alt IANA valid acceptat');
assert(isValidTimeZone('Bucuresti') === false, 'nume liber respins');
assert(isValidTimeZone('') === false, 'gol respins');
assert(isValidTimeZone('Europe/Bucharest ') === false, 'spatii in plus respinse');
assert(isValidTimeZone('GMT+2') === false, 'offset fara zona respins');

console.log(`timezone-rules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
