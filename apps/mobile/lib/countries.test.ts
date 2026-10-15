/**
 * Run: npx tsx lib/countries.test.ts
 * from apps/mobile
 */
import {
  COUNTRIES,
  COUNTRY_TIMEZONES,
  countryByCode,
  countryByName,
  countryCodeOf,
} from './countries';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`);
  }
}

console.log('countries tests\n');

assert(COUNTRIES.length === 30, 'exact 30 de tari');
assert(new Set(COUNTRIES.map((c) => c.code)).size === 30, 'coduri ISO unice');
assert(COUNTRIES.every((c) => c.timezone.startsWith('Europe/')), 'toate fusurile sunt europene');
assert(COUNTRY_TIMEZONES.length === new Set(COUNTRY_TIMEZONES).size, 'fusuri distincte fara duplicate');
assert(countryByCode('RO')?.timezone === 'Europe/Bucharest', 'RO -> Europe/Bucharest');
assert(countryByCode('gb')?.timezone === 'Europe/London', 'cod case-insensitive');
assert(countryCodeOf(null) === 'RO', 'fara tara -> implicit RO');
assert(countryCodeOf('XX') === 'RO', 'cod necunoscut -> implicit RO');
assert(countryByName('Marea Britanie', 'ro')?.code === 'GB', 'cautare dupa nume RO');
assert(countryByName('Turkey', 'en')?.code === 'TR', 'cautare dupa nume EN');
for (const code of ['MD', 'TR', 'FR', 'DE', 'ES', 'IT', 'PL', 'HU', 'BG', 'GR']) {
  assert(countryByCode(code) != null, `prezenta: ${code}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
