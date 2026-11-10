/**
 * Run: npx tsx lib/notifyFeedback.test.ts
 * from apps/mobile
 */
import { applyLanguage } from './language';
import { clientNotifyWarning } from './notifyFeedback';

let failed = 0;
function assert(cond: boolean, name: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

applyLanguage('ro');
assert(clientNotifyWarning({ ok: true }) === null, 'client anunțat: niciun avertisment');
const ro = clientNotifyWarning({ ok: false });
assert(typeof ro === 'string' && ro.includes('nu a putut fi anunțat'), 'eșec: avertisment vizibil în română');
applyLanguage('en');
const en = clientNotifyWarning({ ok: false });
assert(typeof en === 'string' && en.includes('could not be notified'), 'eșec: avertisment vizibil în engleză');

console.log(`notifyFeedback: ${failed === 0 ? 'ok' : `${failed} failed`}`);
if (failed > 0) process.exit(1);
