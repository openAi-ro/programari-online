/**
 * Run: npx tsx lib/recurringRules.test.ts
 * from apps/mobile
 */
import { buildWeeklyStarts, clampRepeatCount, normalizeRepeatSelection } from './recurringRules';

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

console.log('recurringRules tests\n');

// 1) 3 saptamani consecutive, aceeasi ora
{
  const out = buildWeeklyStarts('2026-10-07T07:00:00.000Z', 3);
  assert(
    JSON.stringify(out) === JSON.stringify([
      '2026-10-07T07:00:00.000Z',
      '2026-10-14T07:00:00.000Z',
      '2026-10-21T07:00:00.000Z',
    ]),
    'saptamanal x3 pastreaza ora',
    JSON.stringify(out)
  );
}

// 2) count invalid → eroare
{
  const out = buildWeeklyStarts('2026-10-07T07:00:00.000Z', 1);
  assert(out.length === 0, 'count 1 → gol (macar 2)');
}

// 3) clamp 2..8
{
  assert(clampRepeatCount(1) === 2, 'clamp jos la 2');
  assert(clampRepeatCount(4) === 4, 'clamp pastreaza 4');
  assert(clampRepeatCount(99) === 8, 'clamp sus la 8');
}

// 5) cu timezone, ora locala ramane 09:00 si peste trecerea DST (25 oct 2026)
{
  const out = buildWeeklyStarts('2026-10-20T06:00:00.000Z', 2, 'Europe/Bucharest');
  assert(
    JSON.stringify(out) === JSON.stringify([
      '2026-10-20T06:00:00.000Z', // 09:00 EEST
      '2026-10-27T07:00:00.000Z', // 09:00 EET
    ]),
    'serie cu timezone pastreaza ora locala peste DST',
    JSON.stringify(out)
  );
}

// 4) selectia din UI: 1 ramane o singura sedinta (nu e fortat la serie de 2)
{
  assert(normalizeRepeatSelection(1) === 1, 'selectie 1 → o singura data');
  assert(normalizeRepeatSelection(0) === 1, 'selectie 0 → o singura data');
  assert(normalizeRepeatSelection(NaN) === 1, 'selectie NaN → o singura data');
  assert(normalizeRepeatSelection(3) === 3, 'selectie 3 → serie de 3');
  assert(normalizeRepeatSelection(99) === 8, 'selectie 99 → serie de 8');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
