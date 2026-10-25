/**
 * Run: npx tsx lib/serviceCombo.test.ts
 * from apps/mobile
 */
import {
  comboTotals,
  selectedServices,
  toggleServiceId,
  toggleServiceIdKeepOne,
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

assert(toggleServiceIdKeepOne(['a'], 'a').join() === 'a', 'pagina publică: ultimul serviciu rămâne ales');
assert(toggleServiceIdKeepOne(['a', 'b'], 'a').join() === 'b', 'pagina publică: debifează când mai rămâne unul');
assert(toggleServiceIdKeepOne(['a'], 'c').join() === 'a,c', 'pagina publică: adaugă al doilea');

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

const three = comboTotals(services, toggleServiceId(toggleServiceId(['a'], 'c'), 'b'));
assert(
  three.count === 3 && three.durationMinutes === 65 && three.price === 105 && three.name === 'Tuns + Styling + Barbă',
  '3 servicii alese pe rând: totaluri și ordinea bifării',
  `${three.durationMinutes}/${three.price}/${three.name}`,
);
const strPrice = comboTotals([{ id: 'p', name: 'X', duration_minutes: 10, price: '12.50' as unknown as number }, services[0]], ['p', 'a']);
assert(strPrice.price === 62.5, 'prețul numeric venit ca text din Postgres se adună corect', String(strPrice.price));

console.log(`serviceCombo: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
