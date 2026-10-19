/**
 * Run: npx tsx lib/slots.test.ts
 * from apps/mobile
 */
import { generateFreeSlots, rangesOverlap } from './slots';
import type { BreakHours, WorkingHours } from './types';

const TZ = 'Europe/Bucharest';

/** Monday 2026-08-03 is a Monday */
const MONDAY = '2026-08-03';

const openMonFri: WorkingHours = {
  mon: { closed: false, start: '09:00', end: '12:00' },
  tue: { closed: false, start: '09:00', end: '17:00' },
  wed: { closed: false, start: '09:00', end: '17:00' },
  thu: { closed: false, start: '09:00', end: '17:00' },
  fri: { closed: false, start: '09:00', end: '17:00' },
  sat: { closed: true },
  sun: { closed: true },
};

const noBreak: BreakHours = { enabled: false, start: '13:00', end: '14:00' };

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

function assertEq<T>(actual: T, expected: T, name: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  assert(ok, name, ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('slots tests\n');

// 1) Mon 09-12 duration 60 → 3 slots
{
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [],
  });
  assertEq(slots.length, 3, 'Mon 09-12 duration 60 → 3 slots');
  assertEq(
    slots.map((s) => s.labelLocal),
    ['09:00', '10:00', '11:00'],
    'labels 09:00, 10:00, 11:00'
  );
}

// 2) break 10-11 removes mid slot
{
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: { enabled: true, start: '10:00', end: '11:00' },
    busy: [],
  });
  assertEq(slots.length, 2, 'break 10-11 removes mid → 2 slots');
  assertEq(
    slots.map((s) => s.labelLocal),
    ['09:00', '11:00'],
    'remaining labels 09:00, 11:00'
  );
}

// 3) busy removes first slot (09:00–10:00 Bucharest = 06:00–07:00 UTC in summer EEST)
{
  const all = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [],
  });
  const first = all[0];
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [{ startUtc: first.startUtc, endUtc: first.endUtc }],
  });
  assertEq(slots.length, 2, 'busy removes one slot → 2 left');
  assert(
    !slots.some((s) => s.startUtc === first.startUtc),
    'busy first slot not in free list'
  );
}

// 4) closed day → []
{
  const slots = generateFreeSlots({
    dateLocal: '2026-08-08', // Saturday
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [],
  });
  assertEq(slots.length, 0, 'closed day (Sat) → []');
}

// rangesOverlap unit
{
  const a0 = new Date('2026-08-03T06:00:00.000Z');
  const a1 = new Date('2026-08-03T07:00:00.000Z');
  const b0 = new Date('2026-08-03T06:30:00.000Z');
  const b1 = new Date('2026-08-03T07:30:00.000Z');
  assert(rangesOverlap(a0, a1, b0, b1), 'rangesOverlap true when partial overlap');
  assert(
    !rangesOverlap(a0, a1, a1, new Date('2026-08-03T08:00:00.000Z')),
    'rangesOverlap false when adjacent'
  );
}

// 5) buffer 15 min → step 75, Mon 09-12 duration 60 → 2 slots (09:00, 10:15)
{
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [],
    bufferMinutes: 15,
  });
  assertEq(slots.length, 2, 'buffer 15 → 2 slots in 09-12');
  assertEq(
    slots.map((s) => s.labelLocal),
    ['09:00', '10:15'],
    'labels 09:00, 10:15 with buffer'
  );
}

// 6) blocked date → []
{
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [],
    blockedDates: [MONDAY],
  });
  assertEq(slots.length, 0, 'blocked date → []');
}

// 7) notBeforeUtc hides morning slots
{
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: openMonFri,
    breakHours: noBreak,
    busy: [],
    notBeforeUtc: '2026-08-03T07:30:00.000Z', // 10:30 Bucharest summer
  });
  assertEq(
    slots.map((s) => s.labelLocal),
    ['11:00'],
    'notBeforeUtc keeps only 11:00'
  );
}

// 8) program peste miezul nopții 18:00–02:00 → sloturi și după 00:00
{
  const night: WorkingHours = {
    ...openMonFri,
    mon: { closed: false, start: '18:00', end: '02:00' },
  };
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: night,
    breakHours: noBreak,
    busy: [],
  });
  assertEq(
    slots.map((s) => s.labelLocal),
    ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '00:00', '01:00'],
    'tura de noapte genereaza sloturi peste miezul noptii'
  );
  assert(
    slots[6].startUtc === '2026-08-03T21:00:00.000Z',
    'slotul 00:00 local cade pe 21:00 UTC ziua precedenta (EEST)',
    slots[6].startUtc
  );
}

// 9) bufferul slotului nou nu intra peste programarea urmatoare
{
  const slots = generateFreeSlots({
    dateLocal: MONDAY,
    timezone: TZ,
    sessionDurationMinutes: 60,
    workingHours: { ...openMonFri, mon: { closed: false, start: '09:00', end: '17:00' } },
    breakHours: noBreak,
    // programare existenta 10:10–11:10 local = 07:10–08:10 UTC (EEST)
    busy: [{ startUtc: '2026-08-03T07:10:00.000Z', endUtc: '2026-08-03T08:10:00.000Z' }],
    bufferMinutes: 15,
  });
  assert(
    !slots.some((s) => s.labelLocal === '09:00'),
    'slotul 09:00 e exclus: bufferul lui (pana la 10:15) ar intra peste programarea de 10:10',
    JSON.stringify(slots.map((s) => s.labelLocal))
  );
  assert(
    slots.some((s) => s.labelLocal === '11:30'),
    'primul slot dupa programare incepe dupa bufferul ei (11:25)',
    JSON.stringify(slots.map((s) => s.labelLocal))
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
