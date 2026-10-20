import { grantSignal, timeoutAfterGrant } from './locateTiming';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean) {
  if (ok) passed++;
  else {
    failed++;
    console.error('FAIL', name);
  }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const never = new Promise<never>(() => {});
async function outcome<T>(p: Promise<T>): Promise<string> {
  try {
    return `ok:${String(await p)}`;
  } catch (e) {
    return `err:${(e as Error).message}`;
  }
}

async function main() {
  // Permisiune acordată după 150 ms, poziția vine la 200 ms; timeout 100 ms după acordare -> reușește.
  check('dialog time not counted', (await outcome(timeoutAfterGrant(later(200, 'pos'), later(150, 1), 100))) === 'ok:pos');
  // Același timeout, dar pornit de la început, ar fi expirat (regresia raportată).
  check('old behaviour would time out', (await outcome(timeoutAfterGrant(later(200, 'pos'), Promise.resolve(), 100))) === 'err:location_timeout');
  // După acordare poziția nu vine -> timeout (fără spinner infinit).
  check('times out after grant', (await outcome(timeoutAfterGrant(never, later(20, 1), 50))) === 'err:location_timeout');
  // Fără semnal de acordare: așteptăm poziția / eroarea nativă.
  check('no grant signal -> native result', (await outcome(timeoutAfterGrant(later(120, 'p'), never, 10))) === 'ok:p');
  check('native error passes through', (await outcome(timeoutAfterGrant(Promise.reject(new Error('permission_denied')), never, 10))) === 'err:permission_denied');
  // Poziție rezolvată înainte de acordare: fără timer rămas activ.
  check('resolved before grant', (await outcome(timeoutAfterGrant(Promise.resolve('x'), later(10, 1), 5))) === 'ok:x');

  // grantSignal: deja acordat
  const s1 = grantSignal(async () => ({ state: 'granted' }));
  check('already granted', (await outcome(Promise.race([s1.granted.then(() => 'g'), later(50, 'no')]))) === 'ok:g');
  // grantSignal: prompt -> granted prin eveniment change
  const listeners: Array<() => void> = [];
  const st = { state: 'prompt', addEventListener: (_: 'change', cb: () => void) => listeners.push(cb), removeEventListener: (_: 'change', cb: () => void) => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); } };
  const s2 = grantSignal(async () => st);
  await sleep(10);
  check('prompt not yet granted', (await outcome(Promise.race([s2.granted.then(() => 'g'), later(30, 'no')]))) === 'ok:no');
  st.state = 'granted';
  listeners.forEach((f) => f());
  check('granted on change', (await outcome(Promise.race([s2.granted.then(() => 'g'), later(30, 'no')]))) === 'ok:g');
  check('listener removed', listeners.length === 0);
  // denied -> nu se rezolvă
  const s3 = grantSignal(async () => ({ state: 'denied' }));
  check('denied never grants', (await outcome(Promise.race([s3.granted.then(() => 'g'), later(30, 'no')]))) === 'ok:no');
  s3.dispose();
  // fără Permissions API
  const s4 = grantSignal(null);
  check('no API never grants', (await outcome(Promise.race([s4.granted.then(() => 'g'), later(30, 'no')]))) === 'ok:no');
  // query care eșuează
  const s5 = grantSignal(() => Promise.reject(new Error('x')));
  check('query error never grants', (await outcome(Promise.race([s5.granted.then(() => 'g'), later(30, 'no')]))) === 'ok:no');

  console.log(`${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
void main();
