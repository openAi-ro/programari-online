import type { FreeSlot } from './types';

/** Sloturile libere ale unui specialist pentru ziua aleasă. */
export type StaffSlots = { staffId: string; slots: FreeSlot[] };

/**
 * „Oricine disponibil”: reuniunea sloturilor libere ale specialiștilor, ordonată după oră.
 * Pentru fiecare oră de start păstrăm specialiștii liberi în ordinea primită
 * (ordinea echipei), ca rezervarea să-l încerce întâi pe primul.
 */
export function unionStaffSlots(perStaff: readonly StaffSlots[]): {
  slots: FreeSlot[];
  staffByStart: Record<string, string[]>;
} {
  const byStart = new Map<string, { slot: FreeSlot; staff: string[] }>();
  for (const { staffId, slots } of perStaff) {
    for (const slot of slots) {
      const hit = byStart.get(slot.startUtc);
      if (!hit) byStart.set(slot.startUtc, { slot, staff: [staffId] });
      else if (!hit.staff.includes(staffId)) hit.staff.push(staffId);
    }
  }
  const entries = [...byStart.values()].sort(
    (a, b) => Date.parse(a.slot.startUtc) - Date.parse(b.slot.startUtc)
  );
  return {
    slots: entries.map((e) => e.slot),
    staffByStart: Object.fromEntries(entries.map((e) => [e.slot.startUtc, e.staff])),
  };
}

/**
 * Pe cine încercăm la rezervare: specialistul ales, sau (Oricine) cei liberi la ora aleasă.
 * `null` doar când firma nu are deloc specialiști (comportamentul vechi al serverului).
 */
export function bookingStaffCandidates(
  chosenStaffId: string | null,
  freeAtStart: readonly string[] | undefined,
  teamSize: number
): (string | null)[] {
  if (chosenStaffId) return [chosenStaffId];
  if (teamSize === 0) return [null];
  return [...(freeAtStart ?? [])];
}

/** Eroarea serverului când ora tocmai a fost luată de altcineva. */
export function isSlotTakenError(error: string | null | undefined): boolean {
  return !!error && error.includes('slot_taken');
}

/**
 * Încearcă rezervarea pe rând la fiecare candidat. Trece la următorul doar dacă
 * serverul spune că ora e deja luată; orice altă eroare se oprește imediat.
 */
export async function bookWithFirstFreeStaff<T>(
  candidates: readonly (string | null)[],
  attempt: (staffId: string | null) => Promise<{ value: T | null; error: string | null }>
): Promise<{ value: T | null; error: string | null; staffId: string | null }> {
  let last: { value: T | null; error: string | null; staffId: string | null } = {
    value: null,
    error: 'slot_taken',
    staffId: null,
  };
  for (const staffId of candidates) {
    const res = await attempt(staffId);
    if (!res.error) return { ...res, staffId };
    last = { ...res, staffId };
    if (!isSlotTakenError(res.error)) return last;
  }
  return last;
}