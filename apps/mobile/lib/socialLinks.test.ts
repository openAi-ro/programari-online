/**
 * Run: npx tsx lib/socialLinks.test.ts
 * from apps/mobile
 */
import {
  buildBioText,
  normalizeFacebookUrl,
  normalizeInstagramUrl,
} from './socialLinks';

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

assert(
  normalizeInstagramUrl('@salon.frumos') === 'https://instagram.com/salon.frumos',
  'handle cu @ → URL',
  normalizeInstagramUrl('@salon.frumos') ?? '',
);
assert(
  normalizeInstagramUrl('salon.frumos') === 'https://instagram.com/salon.frumos',
  'handle fără @ → URL',
);
assert(
  normalizeInstagramUrl('https://www.instagram.com/salon.frumos/') ===
    'https://instagram.com/salon.frumos',
  'URL complet → normalizat',
);
assert(normalizeInstagramUrl('') === null, 'gol → null', '');
assert(normalizeInstagramUrl('!!!') === null, 'gunoi → null', '');

assert(
  normalizeFacebookUrl('SalonFrumos') === 'https://facebook.com/SalonFrumos',
  'nume pagină → URL',
);
assert(
  normalizeFacebookUrl('https://www.facebook.com/SalonFrumos/?ref=x') ===
    'https://facebook.com/SalonFrumos',
  'URL cu parametri → curățat',
);
assert(normalizeFacebookUrl('') === null, 'gol → null', '');

const bio = buildBioText('Salon Frumos', 'https://programari.expo.app/b/ABC123');
assert(bio.includes('Salon Frumos'), 'bio conține numele firmei', bio);
assert(bio.includes('https://programari.expo.app/b/ABC123'), 'bio conține linkul de rezervare', bio);
assert(buildBioText('', 'https://x').includes('https://x'), 'bio fără nume → doar link');

console.log(`socialLinks: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
