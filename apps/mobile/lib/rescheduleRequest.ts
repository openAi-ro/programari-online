import type { Appointment } from './types';

type RequestFields = Pick<Appointment, 'status' | 'requested_start_at' | 'requested_end_at'>;

/** O cerere de reprogramare in asteptare (v87): ora ceruta e setata si programarea e activa. */
export function hasPendingReschedule(appt: RequestFields): boolean {
  return (
    Boolean(appt.requested_start_at && appt.requested_end_at) &&
    (appt.status === 'pending' || appt.status === 'approved')
  );
}

/** Filtrul 'De decis': cereri noi (pending) sau reprogramari cerute de client. */
export function needsDecision(appt: RequestFields): boolean {
  return appt.status === 'pending' || hasPendingReschedule(appt);
}

/**
 * Intervalele ocupate chiar de aceasta programare (ora curenta + ora ceruta), care nu trebuie
 * sa blocheze alegerea unei ore noi pentru ea.
 */
export function ownBusyKeys(
  appt: Pick<Appointment, 'start_at' | 'end_at' | 'requested_start_at' | 'requested_end_at'>
): Set<string> {
  const keys = new Set<string>();
  const key = (s: string, e: string) => `${Date.parse(s)}|${Date.parse(e)}`;
  keys.add(key(appt.start_at, appt.end_at));
  if (appt.requested_start_at && appt.requested_end_at) {
    keys.add(key(appt.requested_start_at, appt.requested_end_at));
  }
  return keys;
}

/** True cand un interval ocupat (din list_busy_ranges) e al programarii insesi. */
export function isOwnBusyRange(keys: Set<string>, range: { startUtc: string; endUtc: string }): boolean {
  return keys.has(`${Date.parse(range.startUtc)}|${Date.parse(range.endUtc)}`);
}
