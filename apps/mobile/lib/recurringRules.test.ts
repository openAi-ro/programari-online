/**
 * Run: npx tsx lib/recurringRules.test.ts
 * from apps/mobile
 */
import { buildWeeklyStarts, clampRepeatCount } from './recurringRules';

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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
