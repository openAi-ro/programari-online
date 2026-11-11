// @ts-nocheck
/**
 * Run: npx tsx lib/runda329.test.ts  (din apps/mobile)
 * Runda 3.29: acord „programare/programări” în calendar, „Închisă” la zi închisă (T17),
 * „Mai lipsește:” la un singur element (T21), fără jargon pe ecranul QR și în ajutorul de notificări.
 */
import { readFileSync } from 'node:fs';
import { ro } from './locales/ro';
import { en } from './locales/en';
import { dayCountA11y, dayToneLabelKey } from './bookingCalendar';
import { countArgs, missingListKey } from './roNumber';

let passed = 0;
let failed = 0;
const ok = (c: boolean, n: string) => { if (c) passed++; else { failed++; console.error(`FAIL ${n}`); } };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const trOf = (dict) => (key, params = {}) =>
  dict[key].replace(/\{(\w+)\}/g, (_m, k) => (params[k] === undefined ? `{${k}}` : String(params[k])));
const trRo = trOf(ro);
const trEn = trOf(en);

// Calendar: acordul numărului din eticheta pentru cititorul de ecran.
ok(dayCountA11y(1, 'ro', trRo) === '1 programare', '1 programare');
ok(dayCountA11y(2, 'ro', trRo) === '2 programări', '2 programări');
ok(dayCountA11y(19, 'ro', trRo) === '19 programări', '19 programări');
ok(dayCountA11y(20, 'ro', trRo) === '20 de programări', '20 de programări');
ok(dayCountA11y(101, 'ro', trRo) === '101 programări', '101 programări');
ok(dayCountA11y(1, 'en', trEn) === '1 booking' && dayCountA11y(3, 'en', trEn) === '3 bookings', 'engleză');
ok(/dayCountA11y\(count, lang, tr\)/.test(src('components/BookingCalendar.tsx')), 'calendarul folosește dayCountA11y');

// T17: zi închisă → „Închisă”, atât în celulă, cât și în legenda business.
ok(trRo(dayToneLabelKey('closed', true)) === 'Închisă' && trRo(dayToneLabelKey('closed', false)) === 'Închisă', 'T17 zi închisă');
ok(/LEGEND_BUSINESS[\s\S]*?tone: 'closed', key: 'calendar\.toneClosed'/.test(src('components/BookingCalendar.tsx')), 'T17 legenda conține Închisă');

// T21: singular / plural.
ok(trRo(missingListKey(1), { list: 'sigla firmei' }) === 'Mai lipsește: sigla firmei.', 'T21 un element');
ok(trRo(missingListKey(2), { list: 'telefonul, sigla firmei' }) === 'Mai lipsesc: telefonul, sigla firmei.', 'T21 două elemente');
ok(missingListKey(0) === 'set.missingListOne', 'T21 zero nu cere plural');

// Ecranul QR: fără Expo Go / APK.
const qr = src('app/(app)/business/qr.tsx');
ok(!/expoTitle|expoBody/.test(qr) && !('qr.expoTitle' in ro) && !('qr.expoBody' in en), 'QR: indiciul Expo Go a dispărut');
for (const k of ['qr.installApk', 'qr.scanInstall', 'qr.publicPage', 'qr.publicBody']) {
  ok(!/APK|Expo|localhost|adresă locală|\/b\//.test(ro[k]), `QR ${k} fără jargon`);
}

// Ajutorul pentru canalul Android: fără „Pop on screen” / „importance”, numele canalului neschimbat.
for (const k of ['set.pushAndroidChannel', 'set.channelLow', 'set.pushLowChannel', 'set.popSteps', 'set.pushPopSettings',
  'set.pushAndroidSteps', 'set.pushAndroidNote', 'set.pushReReg', 'set.pushIosNote', 'set.pushIosSteps', 'set.pushEas',
  'push.chanBookingDesc', 'push.chanChatDesc']) {
  ok(!/Pop on screen|importance|webhook|Supabase|projectId|Push reînregistrat/i.test(ro[k]) && !/APNs|EAS/.test(ro[k]), `${k} fără jargon`);
}
ok(ro['push.chanBooking'] === 'Cereri programări (popup)' && ro['set.pushAndroidChannel'].includes('„Cereri programări (popup)”'), 'numele canalului neschimbat');

// „1 afacere” / „5 afaceri” / „20 de afaceri” (retest 3.28, R328-2).
const cnt = (n, one, many, lang = 'ro', extra = {}) => (lang === 'ro' ? trRo : trEn)(...countArgs(n, one, many, lang, extra));
ok(cnt(1, 'cat.countOne', 'cat.count') === '1 afacere', '1 afacere');
ok(cnt(5, 'cat.countOne', 'cat.count') === '5 afaceri', '5 afaceri');
ok(cnt(20, 'cat.countOne', 'cat.count') === '20 de afaceri', '20 de afaceri');
ok(cnt(1, 'cat.countDistOne', 'cat.countDist') === '1 afacere · sortată după distanță', '1 afacere după distanță');
ok(cnt(1, 'browse.catA11yOne', 'browse.catA11y', 'ro', { label: 'Coafură' }) === 'Categorie Coafură, 1 afacere', 'a11y categorie 1');
ok(cnt(21, 'browse.catA11yOne', 'browse.catA11y', 'ro', { label: 'Coafură' }) === 'Categorie Coafură, 21 de afaceri', 'a11y categorie 21');
ok(cnt(1, 'near.countGeoOne', 'near.countGeo') === '1 salon cu distanță' && cnt(3, 'near.countGeoOne', 'near.countGeo') === '3 saloane cu distanță', 'saloane');
ok(cnt(1, 'cat.countOne', 'cat.count', 'en') === '1 business' && cnt(2, 'cat.countOne', 'cat.count', 'en') === '2 businesses', 'engleză afaceri');
for (const f of ['app/(app)/browse/[categoryId].tsx', 'app/(app)/browse/index.tsx', 'app/(app)/map.tsx']) {
  ok(/countArgs\(/.test(src(f)) && !/tr\('(cat\.count|cat\.countDist|browse\.catA11y|near\.countGeo)', \{/.test(src(f)), `${f} folosește countArgs`);
}

// Service worker (R328-1): offline, orice navigare primește shell-ul „/” curent, nu HTML vechi pe rută.
const sw = src('public/sw.js');
ok(/CACHE_VERSION = 'programari-shell-v6'/.test(sw), 'SW: versiune nouă de cache (șterge v5 la activare)');
ok(/keys\.filter\(\(k\) => k !== CACHE_VERSION\)/.test(sw), 'SW: cache-urile vechi se șterg la activare');
ok(/if \(isShell\) putInCache\('\/', res\);/.test(sw) && !/store: true/.test(sw), 'SW: se salvează doar „/”, nu fiecare rută');
ok(/\.catch\(\(\) => caches\.match\('\/'\)\.then\(\(shell\) => shell \|\| offlineFallback\(\)\)\)/.test(sw), 'SW: offline → shell „/”');
ok(/fetch\(bypassHttpCache\(req\)\)/.test(sw) && /cache: 'no-cache'/.test(sw), 'SW: online network-first, fără HTML vechi din cache-ul HTTP');
ok(/self\.skipWaiting\(\)/.test(sw) && /self\.clients\.claim\(\)/.test(sw), 'SW: versiunea nouă preia imediat controlul');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
