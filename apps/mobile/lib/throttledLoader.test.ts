/**
 * Run: npx tsx lib/throttledLoader.test.ts
 * from apps/mobile
 */
import { createThrottledLoader } from './throttledLoader';

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

async function main() {
  let clock = 1_000;
  let calls = 0;
  let next = 3;
  const loader = createThrottledLoader(
    async () => {
      calls += 1;
      return next;
    },
    60_000,
    () => clock
  );

  const [a, b] = await Promise.all([loader.get(), loader.get()]);
  assert(a === 3 && b === 3 && calls === 1, 'cereri simultane → una singură', `calls=${calls}`);

  clock += 30_000;
  next = 5;
  assert((await loader.get()) === 3 && calls === 1, 'sub prag → valoarea din cache');

  assert((await loader.get(true)) === 5 && calls === 2, 'force → cerere nouă');

  clock += 61_000;
  next = 7;
  assert((await loader.get()) === 7 && calls === 3, 'după prag → cerere nouă');

  loader.reset();
  next = 9;
  assert((await loader.get()) === 9 && calls === 4, 'reset → cerere nouă imediat');

  let fail = true;
  const flaky = createThrottledLoader(
    async () => {
      if (fail) throw new Error('net');
      return 1;
    },
    60_000,
    () => clock
  );
  let err = '';
  try {
    await flaky.get();
  } catch (e) {
    err = e instanceof Error ? e.message : '';
  }
  assert(err === 'net', 'eroarea ajunge la apelant');
  fail = false;
  assert((await flaky.get()) === 1, 'după eroare reîncearcă (nu rămâne blocat)');

  // reset în timpul unei cereri: rezultatul vechi nu intră în cache
  let resolveSlow: (v: number) => void = () => {};
  let slowCalls = 0;
  const slow = createThrottledLoader(
    () => {
      slowCalls += 1;
      return slowCalls === 1 ? new Promise<number>((r) => (resolveSlow = r)) : Promise.resolve(2);
    },
    60_000,
    () => clock
  );
  const pending = slow.get();
  slow.reset();
  resolveSlow(1);
  await pending;
  assert((await slow.get()) === 2, 'reset în timpul cererii → valoarea veche nu e păstrată');

  console.log(`throttledLoader: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
