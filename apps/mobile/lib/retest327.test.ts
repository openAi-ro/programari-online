// @ts-nocheck
/**
 * Run: npx tsx lib/retest327.test.ts  (din apps/mobile)
 * Retest 3.27: QR cu nume + logo; eroare = necunoscut (Favorite, Aproape de mine, categorie, Cereri,
 * Adăugare rapidă); texte business (Mesaje, diagnostic notificări, acorduri); ș/ț cu virgulă.
 */
import { readFileSync } from 'node:fs';
import { ro } from './locales/ro';
import { en } from './locales/en';
import { roDe } from './roNumber';

let passed = 0;
let failed = 0;
const ok = (c: boolean, n: string) => { if (c) passed++; else { failed++; console.error(`FAIL ${n}`); } };
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// QR: același link, corecție H, logo doar dacă imaginea se încarcă, numele mereu.
const qr = src('components/BusinessQr.tsx');
ok(/ecl="H"/.test(qr), 'QR: corecție de erori H');
ok(/logoOk && logoUrl/.test(qr) && /Image\.prefetch\(url\)/.test(qr), 'QR: logo doar după ce imaginea se încarcă');
ok(/numberOfLines=\{2\}/.test(qr) && /ellipsizeMode="tail"/.test(qr), 'QR: numele pe max. 2 rânduri, cu …');
ok(/QR_LOGO_RATIO = 0\.22/.test(qr), 'QR: logo ≈22% din latură (sub limita H de 30%)');
const qrScreen = src('app/(app)/business/qr.tsx');
ok(/<BusinessQr value=\{qrValue\} size=\{216\} name=\{business\.name\} logoUrl=\{business\.logo_url\} \/>/.test(qrScreen), 'ecranul QR folosește BusinessQr');
const card = src('components/BusinessVisitCard.tsx');
ok(/<BusinessQr/.test(card) && !/react-native-qrcode-svg/.test(card), 'cartea de vizită folosește BusinessQr');
ok(/return `\$\{getPublicWebOrigin\(\)\}\/b\/\$\{code\}`;/.test(src('lib/bookingLink.ts')), 'linkul codificat rămâne /b/<cod>');

// Favorite: eroare = necunoscut, Reîncearcă, reîncărcare la reconectare.
const favLib = src('lib/favorites.ts');
ok(/if \(error\) return ownerId === user\.id \? memory : null;/.test(favLib) && !/: \[\];\n/.test(favLib.split('syncFavoritesFromCloud')[1].split('getFavoriteIds')[0]), 'favorite: citire eșuată → null, nu []');
const fav = src('app/(app)/favorites.tsx');
ok(/if \(!next\) \{\s*setLoadFailed\(true\);/.test(fav) && /addEventListener\('online', onOnline\)/.test(fav) && /onPress=\{\(\) => void reload\(\)\}/.test(fav), 'favorite: eroare + Reîncearcă + reîncărcare la reconectare');
ok(/if \(idsKnown\.current\) void loadRows\(ids\);/.test(fav), 'favorite: fără „Niciun salon favorit” înainte de o citire reușită');

// Aproape de mine.
const map = src('app/(app)/map.tsx');
ok(/if \(err\) setListError\(userFacingError\(err\)\);\s*else setRows/.test(map), 'hartă: eroarea nu golește lista și e prietenoasă');
ok(/listError \? null : \(/.test(map) && /title=\{tr\('nearby\.loadFail'\)\}/.test(map), 'hartă: fără „Niciun salon găsit”, cu Reîncearcă');

// Categorie.
const cat = src('app/(app)/browse/[categoryId].tsx');
ok(/if \(!err \|\| next\.length > 0\) setRows\(next\);/.test(cat) && /unknown \? null : \(/.test(cat) && /const subtitle = unknown\s*\? undefined/.test(cat), 'categorie: fără „0 afaceri / Niciun rezultat” la eroare, cu Reîncearcă');

// Cereri și adăugare rapidă.
const req = src('app/(app)/business/(tabs)/requests.tsx');
ok((req.match(/setLoadFailed\(true\)/g) ?? []).length >= 2 && /loadFailed \? null : \(/.test(req) && /\{loadFailed \? \(\s*<Button label=\{tr\('common\.retry'\)\}/.test(req), 'Cereri: Reîncearcă la eroare, fără listă goală');
const qa = src('components/QuickAddAppointmentSheet.tsx');
ok(/if \(svcErr \|\| teamErr\) \{\s*setInitError/.test(qa) && /setInitAttempt\(\(n\) => n \+ 1\)/.test(qa), 'Adăugare rapidă: serviciile necunoscute → eroare + Reîncearcă');

// Texte.
const chat = src('components/ChatThread.tsx');
ok(!/'Chat'/.test(chat), 'conversație: fără „Chat” la încărcare');
const set = src('app/(app)/settings.tsx');
ok(/if \(Platform\.OS === 'web'\) \{\s*\/\/ Pe web/.test(set) && /set\.diagWebSub/.test(set), 'diagnostic: pe web doar verificări de browser');
ok(/PERMISSION_LABEL\[diag\.permission\]/.test(set), 'diagnostic: permisiunea în română');
for (const k of ['set.diagPerm', 'set.diagChannel', 'set.missingLow', 'set.diagToken', 'set.diagEas', 'set.easMissing', 'set.diagOk', 'set.diagMissing']) {
  ok(!/importance|Pop on screen|Token|DB|EAS|projectId|build|push/i.test(ro[k]), `ro ${k} fără jargon`);
}
ok(ro['set.permUnavailable'] === 'indisponibilă', 'unavailable → indisponibilă');
ok(roDe(30) === 'de ' && roDe(7) === '' && roDe(101) === '', '„de” de la 20 în sus');
ok(ro['rep.lastDays'] === 'Ultimele {days} {de}zile' && /lang === 'ro' \? roDe\(report\.days\)/.test(src('app/(app)/business/(tabs)/reports.tsx')), 'Ultimele 30 de zile');
ok(ro['rep.confirmedOne'] === 'confirmată' && /s\.approved === 1 \? tr\('rep\.confirmedOne'\)/.test(src('app/(app)/business/(tabs)/reports.tsx')), '1 confirmată / N confirmate');
ok(ro['calendar.toneClosed'] === 'Închisă', 'legenda: Închisă');
ok(ro['set.missingList'].startsWith('Mai lipsesc') && ro['set.missingListOne'].startsWith('Mai lipsește') && /allMissing\.length > 1 \? 'set\.missingList' : 'set\.missingListOne'/.test(set), 'Mai lipsesc / Mai lipsește');
ok(ro['priv.preset30d'] === '30 de zile' && !/rebook/i.test(ro['fav.savedSub']), '30 de zile; fără „rebook”');

// ș/ț cu virgulă.
const geo = src('lib/roGeo.ts');
ok(/nume: roCommaBelow\(j\.nume\)/.test(geo) && /roCommaBelow\(location\.city/.test(src('lib/location.ts')) && /roCommaBelow\(city/.test(src('lib/visitCard.ts')), 'județe/localități cu ș/ț (virgulă) la afișare');

// Formulări de stil T07–T28 (aprobate de Rafael).
ok(ro['setup.sessionDur'] === 'Durata ședinței (minute)' && ro['hours.startLabel'] === 'Ora de început', 'T07/T08');
ok(ro['staff.specialtyPh'].includes('tuns în degrade') && ro['members.roleStaffHelp'].includes('asociat'), 'T10/T11');
ok(ro['svc.image'] === 'Imagine (opțională)' && ro['qa.note'] === 'Notă (opțională)' && ro['req.title'] === 'Cereri de programare', 'T13/T18/T20');
ok(/decât 0/.test(ro['setup.depositHint']) && /filă/.test(ro['btn.buttonHint']) && !/localhost/.test(ro['qr.publicBody']) && ro['qr.openInstall'] === 'Deschide linkul de instalare', 'T22/T24/T26/T28');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
