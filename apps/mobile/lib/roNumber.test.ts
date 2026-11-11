// @ts-nocheck
/** Run: npx tsx lib/roNumber.test.ts */
import { roDe } from './roNumber';
let failed = 0;
const cases: [number, string][] = [[0, ''], [1, ''], [7, ''], [19, ''], [20, 'de '], [30, 'de '], [90, 'de '], [100, 'de '], [101, ''], [105, ''], [119, ''], [120, 'de ']];
for (const [n, want] of cases) if (roDe(n) !== want) { failed++; console.error(`FAIL roDe(${n}) = '${roDe(n)}', aștept '${want}'`); }
console.log(`${cases.length - failed} passed, ${failed} failed`);
if (failed) process.exit(1);
