// @ts-nocheck
/**
 * Run: npx tsx lib/retest324.test.ts  (din apps/mobile)
 * Retest 3.24 / runda 2: ce a picat sau a fost parțial în cele 3 rapoarte.
 * Partea pură se testează direct; legăturile din ecrane (fără randare RN în teste) se păzesc
 * prin sursa ecranului, ca linia care a cauzat bugul să nu revină.
 */
import { readFileSync } from 'node:fs';
import { isNetworkError, userFacingError } from './networkError';
import { notifyLangFor } from './notifyLang';
import { ro } from './locales/ro';
import { en } from './locales/en';

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// P5 offline: eroarea brută de rețea devine mesajul clar, restul rămâne neschimbat.
ok(isNetworkError('TypeError: Failed to fetch'), 'Chrome: Failed to fetch');
ok(isNetworkError('Network request failed'), 'React Native: Network request failed');
ok(isNetworkError('TypeError: Load failed'), 'Safari: Load failed');
ok(!isNetworkError('slot_taken'), 'eroare de business nu e de rețea');
ok(userFacingError('TypeError: Failed to fetch') === ro['common.offline'], 'mesaj „fără internet” în română');
ok(!userFacingError('TypeError: Failed to fetch').includes('TypeError'), 'fără text brut');
ok(userFacingError('Ora tocmai a fost ocupată.') === 'Ora tocmai a fost ocupată.', 'alte mesaje trec neschimbate');
ok(src('lib/useTransientMessage.ts').includes('userFacingError(next)'), 'toate ecranele cu setError trec prin mapare');
const home = src('app/(app)/home.tsx');
ok(home.includes('{loadError ? null : <NearbyCarousel />}'), 'Acasă offline: o singură eroare');
const browse = src('app/(app)/browse/index.tsx');
ok(browse.indexOf("tr('browse.partialList')") < browse.indexOf('<CategoryGrid'), 'Caută: eroarea deasupra categoriilor');

// Rezervare: eroarea orelor e separată, deci reîncărcarea nu șterge mesajul de oră ocupată (R-2).
const book = src('app/(app)/book/[publicCode].tsx');
const loadSlotsBody = book.slice(book.indexOf('const loadSlots = useCallback'), book.indexOf('}, [business, dateLocal, durationMinutes, rescheduleId'));
ok(loadSlotsBody.length > 100 && !loadSlotsBody.includes('setError('), 'loadSlots nu mai atinge eroarea acțiunii');
ok(/if \(err\.includes\('slot_taken'\)\) setStep\('slot'\);\s*else await loadSlots\(\);\s*setError\(mapBookingRpcError\(err\), \{ sticky: true \}\);/.test(book), 'ora ocupată: mesaj persistent pe pasul de ore');
ok(book.includes("label={tr('common.retry')}") && book.includes('setLoadAttempt((n) => n + 1)'), 'rezervare offline: Reîncearcă');
// R-1: ziua din draft trece prin pickedDate, nu e suprascrisă de data implicită.
ok(book.includes('pickedDate.current = draft.dateLocal;') && !book.includes('setDateLocal(draft.dateLocal)'), 'refresh: ziua din draft rămâne');
const pub = src('app/b/[publicCode].tsx');
ok(pub.includes('restorableDraft(readDraft()') && pub.includes('writeDraft({') && pub.includes('pickedDate.current = draft.dateLocal;'), 'pagina publică /b/: selecțiile rămân la refresh');

// Ținte 48 px.
const cal = src('components/BookingCalendar.tsx');
ok(/day: \{\s*width: '100%',\s*maxWidth: spacing\.touchTarget,\s*height: spacing\.touchTarget/.test(cal), 'zilele calendarului: 48 px');
ok(/iconBtn: \{ width: spacing\.touchTarget, height: spacing\.touchTarget/.test(src('app/(app)/business/staff.tsx')), 'Echipă: Mută sus/jos 48 px');

// B4: câmpul de dată web nu mai stă într-un buton dezactivat.
const dp = src('components/DatePickerField.tsx');
const webBranch = dp.slice(dp.indexOf("if (Platform.OS === 'web')"), dp.indexOf('type="date"'));
ok(!webBranch.includes('field('), 'DatePickerField web fără Pressable dezactivat');

// F-E: Programările mele se actualizează live.
ok(/filter: `client_user_id=eq\.\$\{user\.id\}`/.test(src('app/(app)/my-appointments.tsx')), 'Programările mele: realtime pe programările clientului');

// R-5: identitatea clientului pe 2 rânduri.
ok(/styles\.contact, \{ color: t\.colors\.textMuted \}\]\} numberOfLines=\{2\}/.test(src('components/AppointmentCard.tsx')), 'identitate client fără „…” la 390 px');

// F-A: limba dispozitivului salonului nu ajunge în emailul invitatului.
ok(notifyLangFor('business') === undefined, 'acțiune de salon: fără limba salonului');
ok(notifyLangFor('client') === 'ro' || notifyLangFor('client') === 'en', 'acțiune de client: limba lui');
const nc = src('lib/notify-client.ts');
ok(!/notify-moved[\s\S]{0,120}getLanguageSync/.test(nc) && !/notify-postpone[\s\S]{0,120}getLanguageSync/.test(nc), 'mutare/amânare (salon) fără limba salonului');

// P8: texte RO fără engleză / fără diacritice lipsă; „token” scos din textul de diagnostic.
const roValues = Object.values(ro).join('\n');
for (const bad of [/\bpending\b/i, /\bno-show/i, /\bclienti\b/, /\bclientii\b/, /\bwalk-in\b/i]) {
  ok(!bad.test(roValues), `ro.ts fără ${bad}`);
}
ok(!/token/i.test(ro['set.diagHint']) && !/token/i.test(en['set.diagHint']), 'diagnostic fără „token”');
ok(ro['rep.noShow'] === 'Absențe', 'Rapoarte: Absențe');

// F-D: acceptarea propunerii salonului confirmă programarea (migrarea v118, încă neaplicată).
const v118 = src('../../supabase/migrations/20261111003000_v118_client_accept_confirms.sql');
ok(/create or replace function public\.client_accept_reschedule/.test(v118) && /status = 'approved',/.test(v118), 'v118: acceptarea clientului → Confirmată');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
