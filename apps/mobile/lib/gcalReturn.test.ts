/**
 * Run: npx tsx lib/gcalReturn.test.ts
 * from apps/mobile
 */
import { gcalReturnMessageKey, gcalReturnTarget, isMobileUserAgent } from './gcalReturn';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

assert(gcalReturnMessageKey('ok', null) === 'gcal.retOk', 'ok -> mesaj conectat');
assert(gcalReturnMessageKey('error', 'save') === 'gcal.ret_save', 'eroare salvare');
assert(gcalReturnMessageKey('error', 'state') === 'gcal.ret_state', 'eroare state');
assert(gcalReturnMessageKey('error', 'scope') === 'gcal.ret_scope', 'permisiuni calendar debifate');
assert(gcalReturnMessageKey('error', '<script>') === 'gcal.ret_auth', 'motiv necunoscut -> generic');
assert(gcalReturnMessageKey(null, null) === 'gcal.ret_auth', 'fara parametri -> generic');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36';
assert(isMobileUserAgent(ANDROID) && !isMobileUserAgent(DESKTOP), 'detectie telefon');
assert(gcalReturnTarget('android', ANDROID).deepLink === null, 'nativ: navigare interna');
assert(gcalReturnTarget('android', null).path === '/business/settings', 'nativ: Setari');
assert(gcalReturnTarget('web', ANDROID).deepLink === 'programari://business/settings', 'web telefon: deschide aplicatia');
assert(gcalReturnTarget('web', DESKTOP).deepLink === null, 'web desktop: fara deep link');
assert(gcalReturnTarget('web', DESKTOP).path === '/business/settings', 'web desktop: Setari pe web');

console.log(`gcalReturn: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);