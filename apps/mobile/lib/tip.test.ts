/**
 * Run: npx tsx lib/tip.test.ts
 * from apps/mobile
 */
import { parseTipInput, tipOptions } from './tip';

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

const options = tipOptions(200);
assert(options.length === 4, '4 opțiuni de bacșiș', String(options.length));
assert(options[0].percent === 0 && options[0].amount === 0, 'prima opțiune e zero');
assert(options[2].percent === 10 && options[2].amount === 20, '10% din 200 → 20');
assert(options[3].percent === 15 && options[3].amount === 30, '15% din 200 → 30');

assert(parseTipInput('', 200) === 0, 'gol → 0');
assert(parseTipInput('abc', 200) === null, 'gunoi → null');
assert(parseTipInput('-5', 200) === null, 'negativ → null');
assert(parseTipInput('12,5', 200) === 12.5, 'virgulă acceptată', String(parseTipInput('12,5', 200)));
assert(parseTipInput('500', 200) === null, 'peste preț → null');

console.log(`tip: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
