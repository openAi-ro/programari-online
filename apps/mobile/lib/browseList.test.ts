/**
 * Run: npx tsx lib/browseList.test.ts
 * from apps/mobile
 */
import { isOpenNow, sortBusinesses } from './browseList';
import type { WorkingHours } from './types';

const TZ = 'Europe/Bucharest';

const program: WorkingHours = {
  mon: { closed: false, start: '09:00', end: '17:00' },
  tue: { closed: false, start: '09:00', end: '17:00' },
  wed: { closed: false, start: '09:00', end: '17:00' },
  thu: { closed: false, start: '09:00', end: '17:00' },
  fri: { closed: false, start: '09:00', end: '17:00' },
  sat: { closed: true },
  sun: { closed: true },
};

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('browseList tests\n');

// Luni 2026-10-05 10:00 in Bucuresti = 07:00Z (octombrie e inca EEST, +3).
{
  const now = new Date('2026-10-05T07:00:00.000Z');
  assert(isOpenNow(program, TZ, now) === true, 'luni 10:00 → deschis');
}

// Luni 08:59 → inchis (inainte de program).
{
  const now = new Date('2026-10-05T05:59:00.000Z');
  assert(isOpenNow(program, TZ, now) === false, 'luni 08:59 → inchis');
}

// Duminica 12:00 → inchis (zi inchisa).
{
  const now = new Date('2026-10-04T09:00:00.000Z');
  assert(isOpenNow(program, TZ, now) === false, 'duminica → inchis');
}

// Fara program sau timezone → null (nedeterminabil).
{
  const now = new Date('2026-10-05T07:00:00.000Z');
  assert(isOpenNow(null, TZ, now) === null, 'fara program → null');
  assert(isOpenNow(program, null, now) === null, 'fara timezone → null');
}

// Sortare nume RO.
{
  const rows = [
    { name: 'Zebra', avg_rating: null, review_count: 0 },
    { name: 'Ana', avg_rating: null, review_count: 0 },
    { name: 'Mihai', avg_rating: null, review_count: 0 },
  ];
  const out = sortBusinesses(rows, 'name').map((r) => r.name);
  assert(
    JSON.stringify(out) === JSON.stringify(['Ana', 'Mihai', 'Zebra']),
    'sort nume alfabetic',
    JSON.stringify(out)
  );
}

// Sortare rating: cu recenzii primele, descrescator; fara recenzii la final.
{
  const rows = [
    { name: 'Bun', avg_rating: 4.5, review_count: 2 },
    { name: 'Fara', avg_rating: null, review_count: 0 },
    { name: 'Top', avg_rating: 4.9, review_count: 10 },
    { name: 'Zero', avg_rating: 5, review_count: 0 },
  ];
  const out = sortBusinesses(rows, 'rating').map((r) => r.name);
  assert(
    JSON.stringify(out) === JSON.stringify(['Top', 'Bun', 'Fara', 'Zero']),
    'sort rating desc, nulle la final',
    JSON.stringify(out)
  );
}

// Sortare distanta: nulle la final, egalitate → nume.
{
  const rows = [
    { name: 'B', avg_rating: null, review_count: 0 },
    { name: 'A', avg_rating: null, review_count: 0 },
    { name: 'C', avg_rating: null, review_count: 0 },
  ];
  const dist = new Map([
    ['A', 2.5],
    ['B', 0.3],
  ]);
  const out = sortBusinesses(rows, 'distance', (r) => dist.get(r.name) ?? null).map(
    (r) => r.name
  );
  assert(
    JSON.stringify(out) === JSON.stringify(['B', 'A', 'C']),
    'sort distanta crescator, nulle la final',
    JSON.stringify(out)
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
