/**
 * Run: npx tsx lib/workingHoursRules.test.ts
 * from apps/mobile
 */
import { validateSchedule } from './workingHoursRules';
import type { WorkingHours } from './types';

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

const valid: WorkingHours = {
  mon: { closed: false, start: '09:00', end: '18:00' },
  tue: { closed: false, start: '09:00', end: '18:00' },
  wed: { closed: true },
  thu: { closed: false, start: '10:00', end: '14:00' },
  fri: { closed: false, start: '09:00', end: '18:00' },
  sat: { closed: true },
  sun: { closed: true },
};
const noBreak = { enabled: false, start: '', end: '' };

assert(validateSchedule(valid, noBreak) === null, 'program valid acceptat');
assert(
  validateSchedule(valid, { enabled: true, start: '13:00', end: '14:00' }) === null,
  'pauză validă acceptată',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '99:99', end: '18:00' } }, noBreak) === 'hours',
  'oră imposibilă 99:99 respinsă',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '18:00', end: '09:00' } }, noBreak) === 'hours',
  'început după sfârșit respins',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '', end: '18:00' } }, noBreak) === 'hours',
  'oră lipsă respinsă',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '9:00', end: '18:00' } }, noBreak) === 'hours',
  'format fără zero în față respins',
);
assert(
  validateSchedule(valid, { enabled: true, start: '14:00', end: '13:00' }) === 'break',
  'pauză inversată respinsă',
);
assert(
  validateSchedule(valid, { enabled: true, start: '', end: '' }) === 'break',
  'pauză activă dar goală respinsă',
);
assert(
  validateSchedule({ ...valid, wed: { closed: true } }, noBreak) === null,
  'zilele închise nu cer ore',
);

console.log(`workingHoursRules: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
