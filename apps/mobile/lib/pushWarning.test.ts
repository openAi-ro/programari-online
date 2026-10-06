/**
 * Run: npx tsx lib/pushWarning.test.ts
 * from apps/mobile
 */
import { pushWarningForResult } from './pushWarning';

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

assert(pushWarningForResult({ token: 'ExponentPushToken[x]' }) === null, 'cu token, fără avertizare');
assert(pushWarningForResult({ token: null, reason: 'simulator' }) === null, 'simulator ignorat');

const denied = pushWarningForResult({ token: null, reason: 'permission_denied' });
assert(denied?.action === 'settings', 'permisiune refuzată → setări');

const expo = pushWarningForResult({ token: null, reason: 'Expo Go (SDK 53+) nu suporta push' });
assert(expo?.action === 'install', 'Expo Go → instalare APK');

const web = pushWarningForResult({ token: null, reason: 'web_unsupported' });
assert(web?.action === 'install', 'web → instalare APK');

const other = pushWarningForResult({ token: null, reason: 'ceva' });
assert(other !== null && other.action === null, 'alt motiv → avertizare simplă');

console.log(`pushWarning: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
