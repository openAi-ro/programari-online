// @ts-nocheck
/**
 * Run: npx tsx lib/retest325.test.ts  (din apps/mobile)
 * Retest 3.25 / runda 3 (Designer Android, Auditor client, programari bot).
 * Partea pură se testează direct (inclusiv postgrest-js real); legăturile din ecrane se păzesc
 * prin sursa ecranului, ca linia care a cauzat bugul să nu revină.
 */
import { readFileSync } from 'node:fs';
import { PostgrestClient } from '@supabase/postgrest-js';
import { failFastOnNetworkError } from './failFastFetch';
import { isNetworkError } from './networkError';
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

async function main() {
  // R325-3 / Designer 3: fără internet, o citire eșua abia după 1 s + 2 s + 4 s de reîncercări.
  let calls = 0;
  const offline = (async () => {
    calls++;
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  const t0 = Date.now();
  const res = await new PostgrestClient('http://x/rest/v1', { fetch: failFastOnNetworkError(offline) })
    .from('profiles')
    .select('id');
  ok(calls === 1, `offline: o singură cerere, fără reîncercări (au fost ${calls})`);
  ok(Date.now() - t0 < 500, 'offline: eroarea vine imediat');
  ok(isNetworkError(res.error?.message), 'offline: mesajul rămâne „Failed to fetch” → textul prietenos');

  let callsRaw = 0;
  const t1 = Date.now();
  await new PostgrestClient('http://x/rest/v1', {
    fetch: (async () => {
      callsRaw++;
      throw new TypeError('Failed to fetch');
    }) as typeof fetch,
  })
    .from('profiles')
    .select('id');
  ok(callsRaw === 4 && Date.now() - t1 >= 6500, 'control: fără wrapper, biblioteca reîncearcă de 3 ori (~7 s)');

  let calls503 = 0;
  const flaky = (async () => {
    calls503++;
    return calls503 === 1
      ? new Response('', { status: 503, headers: { 'Retry-After': '0' } })
      : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const r503 = await new PostgrestClient('http://x/rest/v1', { fetch: failFastOnNetworkError(flaky) })
    .from('profiles')
    .select('id');
  ok(calls503 === 2 && !r503.error, 'răspunsul 503 al serverului se reîncearcă în continuare');

  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  let abortCode: unknown = 'none';
  await failFastOnNetworkError((async () => {
    throw abort;
  }) as typeof fetch)('http://x').catch((e) => (abortCode = e.code));
  ok(abortCode === undefined, 'AbortError rămâne neatins');

  const supa = src('lib/supabase.ts');
  ok(/global: \{ fetch: failFastOnNetworkError\(/.test(supa), 'clientul Supabase folosește fetch-ul fără reîncercări offline');

  // Designer 1: rolul nu se deduce din date lipsă.
  const appMode = src('lib/appMode.ts');
  ok(/Promise<ModeState \| null>/.test(appMode) && /if \(error \|\| ownedErr \|\| member\.error\) return null;/.test(appMode), 'resolveAppMode: eroare → null, nu „client”');
  ok(appMode.indexOf('return null;') < appMode.indexOf('await setAppMode(mode)'), 'zona nu se salvează când citirea a eșuat');
  const myBiz = src('lib/myBusiness.ts');
  ok(!/return \{ data: await fetchMyBusiness\(ownerUserId\), error: null \}/.test(myBiz) && /if \(error\) return \{ rows: \[\], error \};/.test(myBiz), 'fetchMyBusinessResult raportează eroarea, nu „niciun business”');
  const members = src('lib/businessMembers.ts');
  ok(/if \(error\) return \{ ids: \[\], error \};/.test(members), 'membrii echipei: eroarea ajunge la apelant');
  const layout = src('app/(app)/business/_layout.tsx');
  ok(/setFailed\(!resolved\)/.test(layout) && /biz\.modeLoadFail/.test(layout) && /common\.retry/.test(layout), 'zona business: eroare + Reîncearcă, nu „Cont de client”');
  const settings = src('app/(app)/settings.tsx');
  ok(/if \(modeState\) \{/.test(settings), 'Setări: zona necunoscută nu devine „client”');

  // Designer 2 + 3: Acasă.
  const home = src('app/(app)/home.tsx');
  ok(/useState<AppMode \| null>\(null\)/.test(home) && !/useState<AppMode>\('client'\)/.test(home), 'Acasă: zona nu pornește ca „client”');
  ok(/const readErr = profErr \?\? bizErr;/.test(home) && /failRead\(readErr\.message\)/.test(home), 'Acasă: profilul/business-ul necitit → eroare, nu zonă ghicită');
  ok(/\}\)\(\)\.catch\(\(e: unknown\) => failRead\(/.test(home), 'Acasă: o excepție nu lasă ecranul pe „Se încarcă…”');
  ok(/setStaleNotice\(trKey\(offline \? 'home\.offlineStale' : 'home\.refreshFail'\)\)/.test(home), 'Acasă: datele vechi primesc bannerul');
  ok((home.match(/<StaleNotice /g) ?? []).length === 2, 'bannerul apare și la client, și la business');
  ok(ro['home.offlineStale'] === 'Fără conexiune — datele pot fi vechi.' && Boolean(en['home.offlineStale']), 'text banner ro + en');
  ok(home.indexOf('if (readErr)') > 0 && home.indexOf('if (readErr)') < home.indexOf("from('profiles').insert"), 'profilul nu se re-creează când citirea a eșuat');

  // Auditor (a): fluxul de rezervare are Reîncearcă pe eroarea de încărcare.
  const book = src('app/(app)/book/[publicCode].tsx');
  const firstErr = book.slice(book.indexOf('if (!stepsReady && error && !loading)'), book.indexOf('if (ownBusinessBlock)'));
  ok(/common\.retry/.test(firstErr) && /onPress=\{retryLoad\}/.test(firstErr), 'rezervare offline: butonul Reîncearcă există');

  // Auditor (b): pagina publică nu mai tratează eroarea ca listă goală.
  const pub = src('app/b/[publicCode].tsx');
  ok(!/if \(err\) setError\(err\);\s*setSlots\(free\)/.test(pub) && /setSlotsError\(err\);/.test(pub), '/b/: eroarea orelor nu mai e „0 libere”');
  ok(/const noSlots =\s*!slotsFailed &&/.test(pub), '/b/: fără „Nu există sloturi libere” la eroare');
  ok(/slotsFailed \? tr\('pub\.slotsUnknown'\)/.test(pub) && (pub.match(/onPress=\{\(\) => void reloadSlots\(\)\}/g) ?? []).length >= 2, '/b/: eroare + Reîncearcă în ambele moduri');
  ok(/loading: false, error: err/.test(pub), '/b/ „Oricine”: eroarea pe fiecare calendar');

  // programari bot P2: cardul compact din calendar arată durata și prețul.
  const cal = src('app/(app)/business/calendar.tsx');
  ok(/const priceDuration = serviceSummary\(\{\s*service_duration_minutes: a\.service_duration_minutes,\s*service_price: a\.service_price,/.test(cal) && /\{priceDuration\}/.test(cal), 'calendar: durata și prețul pe card');

  // programari bot: anglicisme în Setări (doar textele, cheile rămân).
  const settingsKeys = ['set.logoHint', 'set.waOn', 'set.newReqHint', 'set.remBizOn', 'set.remOff', 'set.notifSaveBiz', 'set.pushTitle', 'set.pushTest', 'set.diagShow', 'set.diagHide', 'set.diagCheck', 'set.pushIosSteps', 'set.pushAndroidSteps', 'push.testTitle', 'push.testBody', 'setup.buffer', 'setup.badBuffer', 'svc.rebookHint', 'home.cardSettingsHint'];
  for (const k of settingsKeys) {
    ok(Boolean(ro[k]) && !/Home business|reminder|\bpush\b|Buffer|Test popup|popup/i.test(ro[k]), `ro ${k} fără anglicisme`);
  }
  ok(ro['setup.buffer'] === 'Timp liber între ședințe (minute)', 'Buffer → Timp liber între ședințe');
  ok(ro['set.pushIosSteps'].includes('„Trimite o notificare de test”') && ro['set.pushTest'].startsWith('Trimite o notificare de test'), 'pașii numesc butonul cu noul text');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
void main();
