import { bookingStepNumbers } from './bookingSteps';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}
let n = 0;
const ok = (c: boolean, l: string) => {
  assert(c, l);
  n += 1;
};

const all = bookingStepNumbers({ service: true, date: true, time: true });
ok(all.service === 1 && all.date === 2 && all.time === 3, 'toti pasii: 1,2,3');
const noService = bookingStepNumbers({ service: false, date: true, time: true });
ok(noService.service === undefined && noService.date === 1 && noService.time === 2, 'fara serviciu: 1. Data, 2. Ora');
const onlyTime = bookingStepNumbers({ service: false, date: false, time: true });
ok(onlyTime.time === 1, 'doar ora: 1');

console.log(`bookingSteps: ${n} passed, 0 failed`);