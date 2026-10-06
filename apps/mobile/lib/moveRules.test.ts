/**
 * Run: npx tsx lib/moveRules.test.ts
 * from apps/mobile
 */
import { validateMoveInput } from './moveRules';

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

console.log('moveRules tests\n');

const NOW = '2026-10-06T08:00:00.000Z';
const CURRENT = '2026-10-07T07:00:00.000Z';

// 1) fara slot → eroare
{
  const err = validateMoveInput({ slotStartUtc: null, slotEndUtc: null, currentStartUtc: CURRENT, nowIso: NOW });
  assert(err === 'move_slot_required', 'slot lipsa → move_slot_required');
}

// 2) slot in trecut → eroare
{
  const err = validateMoveInput({
    slotStartUtc: '2026-10-06T06:00:00.000Z',
    slotEndUtc: '2026-10-06T06:30:00.000Z',
    currentStartUtc: CURRENT,
    nowIso: NOW,
  });
  assert(err === 'move_in_past', 'slot trecut → move_in_past');
}

// 3) acelasi slot ca cel curent → eroare
{
  const err = validateMoveInput({
    slotStartUtc: CURRENT,
    slotEndUtc: '2026-10-07T07:30:00.000Z',
    currentStartUtc: CURRENT,
    nowIso: NOW,
  });
  assert(err === 'move_same_slot', 'slot identic → move_same_slot');
}

// 4) slot viitor diferit → valid
{
  const err = validateMoveInput({
    slotStartUtc: '2026-10-07T08:00:00.000Z',
    slotEndUtc: '2026-10-07T08:30:00.000Z',
    currentStartUtc: CURRENT,
    nowIso: NOW,
  });
  assert(err === null, 'slot viitor diferit → null');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
