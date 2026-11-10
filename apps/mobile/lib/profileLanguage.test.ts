/**
 * Test încrucișat P6: limba aleasă explicit în Setări se aplică la login pe orice dispozitiv;
 * fără alegere explicită, profilul (și emailurile) preiau limba afișată.
 * Rulează: npx tsx lib/profileLanguage.test.ts
 */
import { languageSyncAction } from './language';

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}: got ${a}, expected ${e}`);
  }
}

const chosenAt = '2026-11-10T21:00:00Z';
eq(languageSyncAction({ language: 'en', language_set_at: chosenAt }, 'ro', false), { kind: 'apply', lang: 'en' }, 'EN ales pe web → EN pe telefonul în română');
eq(languageSyncAction({ language: 'ro', language_set_at: chosenAt }, 'en', false), { kind: 'apply', lang: 'ro' }, 'RO ales explicit → RO pe telefonul în engleză');
eq(languageSyncAction({ language: 'en', language_set_at: chosenAt }, 'en', false), null, 'aceeași limbă → nimic');
eq(languageSyncAction({ language: 'ro', language_set_at: null }, 'en', false), { kind: 'push', lang: 'en' }, 'ro implicit + UI în engleză → profilul preia engleza (emailuri EN)');
eq(languageSyncAction({ language: 'ro', language_set_at: null }, 'ro', false), null, 'ro implicit + UI în română → nimic');
eq(languageSyncAction({ language: 'en', language_set_at: chosenAt }, 'ro', true), null, '?lang= din adresă nu schimbă nimic');
eq(languageSyncAction({ language: 'ro', language_set_at: null }, 'en', true), null, '?lang= din adresă nu scrie în profil');
eq(languageSyncAction({ language: 'de', language_set_at: chosenAt }, 'ro', false), null, 'limbă necunoscută ignorată');
eq(languageSyncAction(null, 'ro', false), null, 'fără profil');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
