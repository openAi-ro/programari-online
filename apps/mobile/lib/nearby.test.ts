/**
 * Run: npx tsx lib/nearby.test.ts
 * from apps/mobile
 */
import { isUsableArea, roundCoords, selectNearby } from './nearby';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); } else { failed += 1; console.error(`  FAIL  ${name}`); }
}
console.log('nearby tests\n');

const b = (name: string, distanceKm: number | null, county: string | null = null, city: string | null = null) => ({ name, distanceKm, county, city });
const rows = [
  b('Departe', 35, 'Gorj', 'Motru'),
  b('Aproape', 3.2, 'Gorj', 'Târgu Jiu'),
  b('Fix 20', 20, 'Gorj', 'Târgu Jiu'),
  b('Fără coordonate', null, 'Gorj', 'Târgu Jiu'),
  b('București', null, 'București', 'București'),
];

const s1 = selectNearby(rows, null);
assert(s1.mode === 'near', 'cu business-uri în 20 km → near');
assert(s1.rows.map((r) => r.name).join(',') === 'Aproape,Fix 20', 'sortate după distanță, 20 km inclus, fără cele de departe / fără coordonate');

const far = rows.map((r) => ({ ...r, distanceKm: r.distanceKm == null ? null : r.distanceKm + 100 }));
const s2 = selectNearby(far, { county: 'Gorj', city: 'Targu Jiu' });
assert(s2.mode === 'area' && s2.byCity, 'nimic în rază → localitatea aleasă (fără diacritice)');
assert(s2.rows.length === 3, '3 business-uri în Târgu Jiu');

const s3 = selectNearby(far, { county: 'gorj', city: 'Craiova' });
assert(s3.mode === 'area' && !s3.byCity && s3.rows.length === 4, 'localitate fără rezultate → județul');
assert(s3.mode === 'area' && s3.label === 'gorj', 'eticheta = zona aleasă');

const s4 = selectNearby(far, { county: 'Cluj', city: null });
assert(s4.mode === 'all' && s4.rows.length === 5, 'zonă fără rezultate → toate');

const s5 = selectNearby(far, null);
assert(s5.mode === 'all', 'fără locație și fără zonă → toate');

const s6 = selectNearby([], { county: 'Gorj', city: null });
assert(s6.mode === 'all' && s6.rows.length === 0, 'listă goală → all gol (UI arată starea goală)');

const many = Array.from({ length: 30 }, (_, i) => b(`B${i}`, i / 2));
assert(selectNearby(many, null).rows.length === 10, 'maxim 10 carduri');
assert(selectNearby(many, null, { radiusKm: 2 }).rows.length === 5, 'raza configurabilă');

const rc = roundCoords({ latitude: 45.04567, longitude: 23.27449 });
assert(rc.latitude === 45.05 && rc.longitude === 23.27, 'coordonate rotunjite la 2 zecimale');
assert(!isUsableArea({ county: ' ', city: null }) && isUsableArea({ county: 'Gorj', city: null }), 'zonă utilizabilă');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
