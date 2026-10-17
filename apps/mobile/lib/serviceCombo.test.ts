/**
 * Run: npx tsx lib/serviceCombo.test.ts
 * from apps/mobile
 */
import {
  comboTotals,
  selectedServices,
  toggleServiceId,
} from './serviceCombo';

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

const services = [
  { id: 'a', name: 'Tuns', duration_minutes: 30, price: 50 },
  { id: 'b', name: 'Barbă', duration_minutes: 20, price: 30 },
  { id: 'c', name: 'Styling', duration_minutes: 15, price: 25 },
];

assert(toggleServiceId([], 'a').join() === 'a', 'alege primul serviciu');
assert(toggleServiceId(['a'], 'b').join() === 'a,b', 'adaugă al doilea serviciu');
assert(toggleServiceId(['a', 'b'], 'a').join() === 'b', 'debifează serviciul ales');
assert(toggleServiceId(['a'], 'a').length === 0, 'debifarea ultimului → gol');

const picked = selectedServices(services, ['b', 'a', 'x']);
assert(
  picked.length === 2 && picked[0].id === 'b' && picked[1].id === 'a',
  'păstrează ordinea alegerii și ignoră id-uri necunoscute',
  picked.map((s) => s.id).join(','),
);

const totals = comboTotals(services, ['a', 'b']);
assert(totals.durationMinutes === 50, 'durata se adună', String(totals.durationMinutes));
assert(totals.price === 80, 'prețul se adună', String(totals.price));
assert(totals.name === 'Tuns + Barbă', 'numele combinat', totals.name);
assert(totals.count === 2, 'număr servicii', String(totals.count));

const empty = comboTotals(services, []);
assert(
  empty.durationMinutes === 0 && empty.price === 0 && empty.name === '' && empty.count === 0,
  'fără selecție → total zero',
);

console.log(`serviceCombo: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
