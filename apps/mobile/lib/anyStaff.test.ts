import {
  bookWithFirstFreeStaff,
  bookingStaffCandidates,
  isSlotTakenError,
  unionStaffSlots,
} from './anyStaff';
import type { FreeSlot } from './types';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}

const slot = (iso: string, label: string): FreeSlot => ({
  startUtc: iso,
  endUtc: new Date(Date.parse(iso) + 30 * 60000).toISOString(),
  labelLocal: label,
});

async function main() {
  let n = 0;
  const ok = (c: boolean, l: string) => {
    assert(c, l);
    n += 1;
  };

  // Reuniune: ore unice, ordonate, specialiștii în ordinea echipei
  const u = unionStaffSlots([
    { staffId: 'ana', slots: [slot('2026-10-22T07:00:00.000Z', '10:00'), slot('2026-10-22T08:00:00.000Z', '11:00')] },
    { staffId: 'miha', slots: [slot('2026-10-22T06:30:00.000Z', '09:30'), slot('2026-10-22T07:00:00.000Z', '10:00')] },
  ]);
  ok(u.slots.map((s) => s.labelLocal).join(',') === '09:30,10:00,11:00', 'ore unice si ordonate');
  ok(u.staffByStart['2026-10-22T07:00:00.000Z'].join(',') === 'ana,miha', '10:00 libera la ana apoi miha');
  ok(u.staffByStart['2026-10-22T06:30:00.000Z'].join(',') === 'miha', '09:30 doar miha');
  ok(unionStaffSlots([]).slots.length === 0, 'fara specialisti -> fara sloturi');
  const dup = unionStaffSlots([{ staffId: 'a', slots: [slot('2026-10-22T07:00:00.000Z', '10:00'), slot('2026-10-22T07:00:00.000Z', '10:00')] }]);
  ok(dup.slots.length === 1 && dup.staffByStart['2026-10-22T07:00:00.000Z'].length === 1, 'fara dubluri');

  // Candidați
  ok(bookingStaffCandidates('ana', ['miha'], 3).join(',') === 'ana', 'specialist ales -> doar el');
  ok(bookingStaffCandidates(null, ['ana', 'miha'], 3).join(',') === 'ana,miha', 'oricine -> liberii in ordine');
  const none = bookingStaffCandidates(null, undefined, 0);
  ok(none.length === 1 && none[0] === null, 'firma fara echipa -> null (vechiul comportament)');
  ok(bookingStaffCandidates(null, undefined, 2).length === 0, 'oricine fara liberi -> nimeni (niciodata null)');

  ok(isSlotTakenError('slot_taken - details') && !isSlotTakenError('too_soon') && !isSlotTakenError(null), 'detectie slot_taken');

  // Rezervare: trece la următorul doar la slot_taken
  const tried: (string | null)[] = [];
  const r1 = await bookWithFirstFreeStaff(['ana', 'miha'], async (id) => {
    tried.push(id);
    return id === 'ana' ? { value: null, error: 'slot_taken' } : { value: 'appt-miha', error: null };
  });
  ok(r1.value === 'appt-miha' && r1.staffId === 'miha' && tried.join(',') === 'ana,miha', 'ana luata -> miha');

  const tried2: (string | null)[] = [];
  const r2 = await bookWithFirstFreeStaff(['ana', 'miha'], async (id) => {
    tried2.push(id);
    return { value: null, error: 'too_soon' };
  });
  ok(r2.error === 'too_soon' && tried2.length === 1, 'alta eroare -> stop imediat');

  const r3 = await bookWithFirstFreeStaff(['ana', 'miha'], async () => ({ value: null, error: 'slot_taken' }));
  ok(isSlotTakenError(r3.error) && r3.value === null, 'toti ocupati -> slot_taken');

  const r4 = await bookWithFirstFreeStaff([], async () => ({ value: 'x', error: null }));
  ok(isSlotTakenError(r4.error), 'fara candidati -> slot_taken, fara apel');

  console.log(`anyStaff: ${n} passed, 0 failed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});