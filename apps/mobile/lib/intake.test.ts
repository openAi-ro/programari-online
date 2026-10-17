/**
 * Run: npx tsx lib/intake.test.ts
 * from apps/mobile
 */
import { normalizeIntakeText, photoKindLabel } from './intake';

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

assert(normalizeIntakeText('  Penicilină  ') === 'Penicilină', 'curăță spațiile');
assert(normalizeIntakeText('').length === 0, 'gol → gol');
assert(normalizeIntakeText(null).length === 0, 'null → gol');
assert(normalizeIntakeText('a'.repeat(600)).length === 500, 'limitează la 500 caractere');

assert(photoKindLabel('before') === 'before', 'etichetă before');
assert(photoKindLabel('after') === 'after', 'etichetă after');
assert(photoKindLabel('altceva') === 'before', 'necunoscut → before');

console.log(`intake: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
