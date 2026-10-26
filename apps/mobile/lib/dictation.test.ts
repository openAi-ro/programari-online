/**
 * Run: npx tsx lib/dictation.test.ts
 * from apps/mobile
 */
import { dictationErrorKind, joinDictation } from './dictation';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

assert(joinDictation('', ' bună ziua ') === 'bună ziua', 'câmp gol -> doar textul dictat');
assert(joinDictation('Salut,', 'pot veni mâine') === 'Salut, pot veni mâine', 'se adaugă după ce era scris');
assert(joinDictation('Salut  ', 'la  ora   10 ') === 'Salut la ora 10', 'spații normalizate');
assert(joinDictation('Salut', '   ') === 'Salut', 'nimic dictat -> ciorna rămâne');
assert(dictationErrorKind('not-allowed') === 'denied', 'permisiune refuzată');
assert(dictationErrorKind('no-speech') === null && dictationErrorKind('aborted') === null && dictationErrorKind('speech-timeout') === null, 'fără vorbire / oprit -> fără mesaj');
assert(dictationErrorKind('network') === 'failed', 'altă eroare -> mesaj generic');

console.log(`dictation: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
