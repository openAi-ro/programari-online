/**
 * Run: npx tsx lib/visitCard.test.ts
 * from apps/mobile
 */
import { DEFAULT_WORKING_HOURS } from './defaults';
import {
  businessIdFromExternalId,
  businessToVisitCardProps,
  formatPublicLocation,
} from './visitCard';

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

assert(businessIdFromExternalId('biz-abc123') === 'abc123', 'extrage id business');
assert(businessIdFromExternalId('mp_x') === null, 'punct manual fără business');
assert(businessIdFromExternalId(null) === null, 'externalId lipsă');
assert(businessIdFromExternalId('biz-') === null, 'prefix gol respins');

const props = businessToVisitCardProps(
  {
    name: 'Salon Test',
    public_code: 'ABC123',
    working_hours: null as never,
    county: 'Cluj',
    city: 'Cluj-Napoca',
    address: 'Str. Test 1',
    maps_url: null,
    latitude: 46.77,
    longitude: 23.6,
  },
  '0700000000'
);
assert(props.name === 'Salon Test', 'nume pe card');
assert(props.phone === '0700000000', 'telefon pe card');
assert(props.publicCode === 'ABC123', 'cod public pentru QR');
assert(props.location.latitude === 46.77, 'coordonate pe card');
assert(props.workingHours === DEFAULT_WORKING_HOURS, 'fallback program implicit');

assert(
  formatPublicLocation('Cluj-Napoca', 'Cluj') === 'Cluj-Napoca, Cluj',
  'oras + judet'
);
assert(formatPublicLocation('Iasi', null) === 'Iasi', 'doar orasul');
assert(formatPublicLocation(null, 'Brasov') === 'Brasov', 'doar judetul');
assert(formatPublicLocation(null, null) === null, 'lipsa localitate -> null');
assert(formatPublicLocation('  ', '  ') === null, 'spatii goale -> null');

console.log(`visitCard: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
