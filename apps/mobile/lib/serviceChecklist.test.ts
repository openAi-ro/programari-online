/**
 * Run: npx tsx lib/serviceChecklist.test.ts
 * from apps/mobile
 */
import { serviceChecklistState } from './serviceChecklist';

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

const none = serviceChecklistState([]);
assert(none.kind === 'none', 'fără servicii → none', none.kind);

const active = serviceChecklistState([
  { name: 'Tuns', active: false },
  { name: 'Barbă', active: true },
]);
assert(active.kind === 'ok', 'cu serviciu activ → ok', active.kind);

const one = serviceChecklistState([{ name: 'Tuns', active: false }]);
assert(one.kind === 'inactive', 'un serviciu inactiv → inactive', one.kind);
assert(
  one.kind === 'inactive' && one.names.length === 1 && one.names[0] === 'Tuns',
  'numele serviciului inactiv e returnat',
  one.kind === 'inactive' ? one.names.join(',') : '',
);

const many = serviceChecklistState([
  { name: ' Tuns ', active: false },
  { name: 'Barbă', active: false },
  { name: '  ', active: false },
]);
assert(many.kind === 'inactive', 'mai multe inactive → inactive', many.kind);
assert(
  many.kind === 'inactive' &&
    many.names.length === 2 &&
    many.names[0] === 'Tuns' &&
    many.names[1] === 'Barbă',
  'numele inactive sunt curățate și fără goluri',
  many.kind === 'inactive' ? many.names.join(',') : '',
);

console.log(`serviceChecklist: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
