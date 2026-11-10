/**
 * Run: npx tsx lib/phone.test.ts  (din apps/mobile)
 * Test încrucișat, Designer F-6: „abc” la telefon trebuie semnalat imediat.
 */
import { phoneProblem, phoneTypingProblem } from './phone';

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, name: string) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}: got ${String(actual)}, expected ${String(expected)}`);
  }
}

eq(phoneTypingProblem('abc'), 'invalid', 'abc → invalid imediat');
eq(phoneTypingProblem('07'), null, '07 în curs de scriere → fără eroare');
eq(phoneTypingProblem('0722 123 456'), null, 'mobil RO valid');
eq(phoneTypingProblem('+40 722-123-456'), null, 'mobil RO cu +40 și cratime');
eq(phoneTypingProblem('+39 333 123 4567'), 'notRo', 'număr străin complet → notRo');
eq(phoneTypingProblem(''), null, 'gol → fără eroare');
eq(phoneProblem(''), null, 'gol la salvare → ok (opțional)');
eq(phoneProblem('abc'), 'invalid', 'abc la salvare → invalid');
eq(phoneProblem('07'), 'invalid', '07 la salvare → invalid');
eq(phoneProblem('0722123456'), null, 'mobil valid la salvare');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
