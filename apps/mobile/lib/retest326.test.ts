// @ts-nocheck
/**
 * Run: npx tsx lib/retest326.test.ts  (din apps/mobile)
 * Retest 3.26 / runda 4: o citire eșuată înseamnă „necunoscut”, nu listă goală;
 * termeni englezești pe ecrane (decizii TypeSafe r4). Legăturile din ecrane se păzesc prin sursă.
 */
import { readFileSync } from 'node:fs';
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

// 1. Fluxul de programare: la eroare nu mai golim sloturile și nu arătăm „0 libere” / „Locurile sunt ocupate”.
const book = src('app/(app)/book/[publicCode].tsx');
const errBranch = book.match(/if \(err\) \{[\s\S]*?return;\s*\}/g)?.find((b) => b.includes('setSlotsError(userFacingError(err))')) ?? '';
ok(errBranch.length > 0 && !/setSlots\(\[\]\)|setStaffSlots\(\[\]\)/.test(errBranch), 'book: eroarea de sloturi nu mai pune listă goală');
ok(/const slotsEmpty = !slotsLoading && !slotsError && freeCount === 0;/.test(book), 'book: „gol” doar fără eroare');
ok(!/!slotsLoading && freeCount === 0/.test(book), 'book: lista de așteptare nu mai folosește freeCount fără eroare');
ok((book.match(/slotsEmpty/g) ?? []).length >= 3, 'book: ambele subsoluri „Locurile sunt ocupate” folosesc slotsEmpty');
ok(/slotsError \? tr\('pub\.slotsUnknown'\) : tr\('book\.freeCount'/.test(book), 'book: insigna arată „necunoscut”, nu „0 libere”');
ok(/\) : slotsError \? null : anyMode && !slotsLoading \?/.test(book), 'book: lista/„Nicio oră liberă” ascunse cât există eroarea');
ok(/onClose=\{error \? \(\) => setError\(null\) : undefined\}/.test(book) && !/setSlotsError\(null\);\s*\}\}/.test(book), 'book: eroarea de sloturi nu se poate închide (rămâne până la Reîncearcă)');

// 2. /b/ „Oricine”: cardul specialistului arată eroarea, nu titlul „Nicio oră liberă”.
const card = src('components/StaffSlotsCard.tsx');
ok(/error\?: string \| null;/.test(card) && /\) : error \? \(/.test(card), 'StaffSlotsCard: prop error care înlocuiește SlotPicker');
const pub = src('app/b/[publicCode].tsx');
ok(/error=\{day\?\.error \? slotsErrorText : null\}/.test(pub) && !/emptyLabel=\{day\?\.error/.test(pub), '/b/: eroarea merge în error, nu în emptyLabel');

// 3. Alte locuri unde o eroare devenea „gol”.
const reqs = src('app/(app)/business/(tabs)/requests.tsx');
ok(/useState<FreeSlot\[\] \| null>/.test(reqs) && (reqs.match(/setMoveSlots\(null\)/g) ?? []).length === 2 && !/setMoveSlots\(\[\]\)/.test(reqs), 'cereri/mutare: eroare → necunoscut (null)');
ok(/moveSlots === null \?/.test(reqs), 'cereri/mutare: Reîncearcă în loc de „Nu mai sunt ore libere”');
const qa = src('components/QuickAddAppointmentSheet.tsx');
ok(/busyErr\s*\?\s*null/.test(qa) && /slots === null \?/.test(qa), 'adăugare rapidă: eroare → necunoscut + Reîncearcă');
for (const f of ['staff', 'services', 'packages', 'waitlist', 'reviews', 'calendar', '(tabs)/clients']) {
  const s = src(`app/(app)/business/${f}.tsx`);
  ok(/setLoadFailed\(true\)/.test(s) && /loadFailed \?/.test(s), `${f}: eroare de citire → fără mesaj de „gol”`);
}
for (const f of ['packages', 'waitlist', 'reviews']) {
  const s = src(`app/(app)/business/${f}.tsx`);
  ok(/const \{ data: biz, error: bErr \} = await fetchMyBusinessResult/.test(s), `${f}: eroarea la citirea afacerii nu mai e ignorată`);
}
const priv = src('app/(app)/business/private-codes.tsx');
ok(/fetchMyBusinessResult/.test(priv) && /codes\.length === 0 && !listError/.test(priv) && /clients\.length === 0 && !listError/.test(priv), 'coduri private: eroare ≠ „configurează” / „niciun cod”');
const favLib = src('lib/favorites.ts');
ok(/if \(error \|\| !data\) return null;/.test(favLib), 'favorite: eroare → null');
const fav = src('app/(app)/favorites.tsx');
ok(/loadFailed \?/.test(fav) && Boolean(ro['fav.loadFail']) && Boolean(en['fav.loadFail']), 'favorite: eroare + Reîncearcă, nu „Nu ai favorite”');

// 4. Termeni (TypeSafe r4): business→afacere 0.76, slot→oră liberă 0.98, app→aplicație 0.69,
//    chat→Mesaje 0.61, Web Push→notificări în browser 0.69; link/Admin/bio rămân.
const values = Object.entries(ro).filter(([k]) => !['setup.reviewHint'].includes(k));
for (const [k, v] of values) {
  ok(!/\bbusiness\b|business-|\bslot\w*|\bapp\b|app-ul|Web Push|\bchat\w*/i.test(String(v).replace(/\{business\}/g, '').replace(/App Store/g, '')), `ro ${k} fără business/slot/app/chat/Web Push`);
}
ok(ro['slots.emptyTitle'] === 'Nicio oră liberă', 'slot → oră liberă');
ok(ro['home.yourBusiness'] === 'Afacerea ta' && ro['set.bizAccount'] === 'Cont de afacere', 'business → afacere');
ok(ro['members.roleAdmin'] === 'Admin', 'Admin rămâne (TypeSafe 0.57)');
ok(/bio/.test(ro['setup.copyBio']) && /link/.test(ro['home.enterCode']), 'bio și link rămân');
ok(ro['setup.reviewHint'].includes('Google Business'), 'numele propriu Google Business rămâne');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
