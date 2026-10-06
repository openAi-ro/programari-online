/**
 * Run: npx tsx lib/mapPoints.test.ts
 * from apps/mobile
 */
import { loadPoints, removePoint, upsertPoint, type MapPointStorage } from './mapPoints';

function memoryStorage(): MapPointStorage & { dump: () => string | null } {
  let value: string | null = null;
  return {
    dump: () => value,
    getItem: async () => value,
    setItem: async (_k, v) => {
      value = v;
    },
  };
}

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
  const s = memoryStorage();
  assert((await loadPoints(s)).length === 0, 'pornește gol');

  const created = await upsertPoint(s, {
    latitude: 44.3193,
    longitude: 23.7967,
    title: 'Cabinet Exemplu',
    phone: '0700000000',
  });
  assert(Boolean(created.id), 'creează cu id');
  assert((await loadPoints(s)).length === 1, 'un punct după creare');

  await upsertPoint(s, {
    latitude: 44.32,
    longitude: 23.8,
    title: 'Cabinet Exemplu',
    externalId: 'biz-1',
  });
  await upsertPoint(s, {
    latitude: 44.33,
    longitude: 23.81,
    title: 'Cabinet Exemplu mutat',
    externalId: 'biz-1',
  });
  const after = await loadPoints(s);
  assert(after.length === 2, 'upsert externalId nu duplică', `got ${after.length}`);
  assert(
    after.find((p) => p.externalId === 'biz-1')?.title === 'Cabinet Exemplu mutat',
    'upsert externalId actualizează'
  );

  let threw = false;
  try {
    await upsertPoint(s, { latitude: 999, longitude: 0, title: 'X' });
  } catch {
    threw = true;
  }
  assert(threw, 'coordonate invalide sunt respinse');

  await removePoint(s, created.id);
  assert((await loadPoints(s)).length === 1, 'ștergerea elimină punctul');
  assert(Boolean(s.dump()?.includes('biz-1')), 'persistența păstrează restul');

  console.log(`mapPoints: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
