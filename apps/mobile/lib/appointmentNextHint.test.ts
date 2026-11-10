/** Run: npx tsx lib/appointmentNextHint.test.ts (from apps/mobile) */
import { appointmentNextHint } from './appointmentNextHint';
import { ro } from './locales/ro';
import { slotTimeLabel } from './rescheduleRequest';

let n = 0;
const ok = (c: boolean, l: string) => {
  if (!c) throw new Error(`FAIL: ${l}`);
  n += 1;
};

ok(appointmentNextHint('approved', { canCancel: true, canReschedule: true }) === ro['hint.approvedCanChange'], 'aprobata: poate muta si anula');
// Propunere a salonului in asteptare: reprogramarea e blocata, textul nu o mai pomeneste.
const during = appointmentNextHint('approved', { canCancel: true, canReschedule: false });
ok(during === ro['hint.approvedCanCancel'], 'aprobata, doar anulare');
ok(!/reprogram/i.test(during), 'fara „reprogramare” cand nu se poate');
ok(appointmentNextHint('pending', { canCancel: true }) === ro['hint.pendingCanCancel'], 'in asteptare, doar anulare');
ok(appointmentNextHint('pending', { canReschedule: true }) === ro['hint.pendingCanChange'], 'in asteptare, poate muta');
ok(appointmentNextHint('approved', { tooLate: true }) === ro['hint.tooLateToChange'], 'prea tarziu');
ok(appointmentNextHint('approved', {}) === ro['hint.approved'], 'aprobata fara actiuni');
ok(appointmentNextHint('cancelled', { canCancel: true }) === ro['hint.cancelled'], 'anulata ignora canCancel');

ok(slotTimeLabel('2026-11-12T12:30:00Z', 'Europe/Bucharest') === '12.11.2026 · 14:30', 'ora scurta in fusul firmei');
ok(slotTimeLabel('2026-03-29T01:30:00Z', 'Europe/Bucharest') === '29.03.2026 · 04:30', 'dupa trecerea la ora de vara');

console.log(`appointmentNextHint: ${n} passed, 0 failed`);
