/**
 * Run: npx tsx lib/useTransientMessage.test.ts
 * from apps/mobile
 */
import { createTransientClock, TRANSIENT_MESSAGE_MS } from './useTransientMessage';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

// Ceas fals: avansăm timpul manual.
let now = 0;
let pending: Array<{ at: number; fn: () => void; id: number }> = [];
let nextId = 1;
const timers = {
  set: (fn: () => void, ms: number) => {
    const id = nextId++;
    pending.push({ at: now + ms, fn, id });
    return id;
  },
  clear: (h: unknown) => {
    pending = pending.filter((p) => p.id !== h);
  },
};
function advance(ms: number) {
  now += ms;
  const due = pending.filter((p) => p.at <= now);
  pending = pending.filter((p) => p.at > now);
  due.forEach((p) => p.fn());
}

let cleared = 0;
const clock = createTransientClock(() => (cleared += 1), TRANSIENT_MESSAGE_MS, timers);

assert(TRANSIENT_MESSAGE_MS === 30_000, '30 de secunde');
clock.arm();
advance(29_999);
assert(cleared === 0, 'nu dispare inainte de 30 s');
advance(1);
assert(cleared === 1, 'dispare la 30 s');

clock.arm();
advance(20_000);
clock.arm(); // mesaj nou -> timer repornit
advance(20_000);
assert(cleared === 1, 'mesaj nou reporneste cele 30 s');
advance(10_000);
assert(cleared === 2, 'mesajul nou dispare la 30 s de la afisare');
assert(pending.length === 0, 'un singur timer activ');

clock.arm(true);
advance(120_000);
assert(cleared === 2 && pending.length === 0, 'sticky nu dispare singur');

clock.arm();
clock.cancel(); // demontare / mesaj sters manual
advance(60_000);
assert(cleared === 2 && pending.length === 0, 'cancel opreste timerul');

console.log(`useTransientMessage: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
