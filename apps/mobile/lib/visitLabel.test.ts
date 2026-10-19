/**
 * Run: npx tsx lib/visitLabel.test.ts
 * from apps/mobile
 */
import { visitCountKey } from './visitLabel';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.error(`  FAIL  ${name}`); }
}
console.log('visitLabel tests\n');
assert(visitCountKey(1) === 'cli.visitOne', '1 vizită');
assert(visitCountKey(0) === 'cli.visits', '0 vizite');
assert(visitCountKey(2) === 'cli.visits', '2 vizite');
assert(visitCountKey(19) === 'cli.visits', '19 vizite');
assert(visitCountKey(20) === 'cli.visitsMany', '20 de vizite');
assert(visitCountKey(100) === 'cli.visitsMany', '100 de vizite');
assert(visitCountKey(101) === 'cli.visits', '101 vizite');
assert(visitCountKey(120) === 'cli.visitsMany', '120 de vizite');
assert(visitCountKey(Number('3')) === 'cli.visits', 'bigint-ca-string din RPC (3) -> vizite');
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
