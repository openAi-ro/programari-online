/**
 * Run: npx tsx lib/latestRequest.test.ts
 * from apps/mobile
 */
import { createRequestTracker } from './latestRequest';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.error(`  FAIL  ${name}`); }
}

async function main() {
  console.log('latestRequest tests\n');
  const t = createRequestTracker();
  const a = t.start();
  assert(t.isCurrent(a), 'singura cerere e curentă');
  const b = t.start();
  assert(!t.isCurrent(a), 'cererea veche nu mai e curentă după una nouă');
  assert(t.isCurrent(b), 'cea nouă e curentă');
  assert(!t.isCurrent(0), 'id 0 nu e curent');
  const other = createRequestTracker();
  other.start(); other.start(); other.start();
  assert(t.isCurrent(b), 'trackere separate nu se influențează');

  // Simulare: 4 încărcări pentru date intermediare, răspunsurile vin în altă ordine.
  const tr = createRequestTracker();
  let shown = '';
  const load = (date: string, delayMs: number) => {
    const id = tr.start();
    return new Promise<void>((res) => setTimeout(() => { if (tr.isCurrent(id)) shown = date; res(); }, delayMs));
  };
  await Promise.all([
    load('2026-01-20', 40),
    load('2026-10-20', 10),
    load('2026-10-02', 60),
    load('2026-10-21', 5),
  ]);
  assert(shown === '2026-10-21', 'răspunsul ultimei date câștigă chiar dacă vine primul');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
void main();
