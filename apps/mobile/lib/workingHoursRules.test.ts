/**
 * Run: npx tsx lib/workingHoursRules.test.ts
 * from apps/mobile
 */
import { formatTimeRange, isOvernightRange, validateSchedule } from './workingHoursRules';
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
  validateSchedule({ ...valid, mon: { closed: false, start: '22:00', end: '02:00' } }, noBreak) === null,
  'program peste noapte 22:00–02:00 acceptat',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '18:00', end: '09:00' } }, noBreak) === null,
  'sfârșit înainte de început = a doua zi (acceptat)',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '10:00', end: '10:00' } }, noBreak) === 'hours',
  'început egal cu sfârșit respins',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '22:00', end: '24:00' } }, noBreak) === 'hours',
  '24:00 respins (format)',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '22:00', end: '2:00' } }, noBreak) === 'hours',
  'oră fără zero în față respinsă și peste noapte',
);
assert(
  validateSchedule(valid, { enabled: true, start: '23:30', end: '00:30' }) === null,
  'pauză peste miezul nopții acceptată',
);
assert(
  validateSchedule(valid, { enabled: true, start: '13:00', end: '13:00' }) === 'break',
  'pauză de durată zero respinsă',
);
assert(formatTimeRange('22:00', '02:00', '(+1 zi)') === '22:00–02:00 (+1 zi)', 'afișare 22:00–02:00 (+1 zi)');
assert(formatTimeRange('09:00', '18:00', '(+1 zi)') === '09:00–18:00', 'afișare normală fără +1 zi');
assert(isOvernightRange('22:00', '02:00') && !isOvernightRange('09:00', '18:00'), 'detectare peste noapte');
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '', end: '18:00' } }, noBreak) === 'hours',
  'oră lipsă respinsă',
);
assert(
  validateSchedule({ ...valid, mon: { closed: false, start: '9:00', end: '18:00' } }, noBreak) === 'hours',
  'format fără zero în față respins',
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
