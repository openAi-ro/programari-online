import type { Appointment } from './types';

type RequestFields = Pick<
  Appointment,
  'status' | 'requested_start_at' | 'requested_end_at' | 'reschedule_proposed_by' | 'client_user_id'
>;

/** O cerere/propunere de reprogramare in asteptare: ora ceruta e setata si programarea e activa. */
export function hasPendingReschedule(appt: RequestFields): boolean {
  return (
    Boolean(appt.requested_start_at && appt.requested_end_at) &&
    (appt.status === 'pending' || appt.status === 'approved')
  );
}

/** Cine a deschis cererea. Randurile vechi (null) = client (v87). */
export function rescheduleProposedBy(
  appt: Pick<Appointment, 'reschedule_proposed_by'>
): 'client' | 'business' | null {
  if (!appt.reschedule_proposed_by) return null;
  if (appt.reschedule_proposed_by === 'business') return 'business';
  if (appt.reschedule_proposed_by === 'client') return 'client';
  return null;
}

export function isClientProposedReschedule(appt: RequestFields): boolean {
  if (!hasPendingReschedule(appt)) return false;
  const by = rescheduleProposedBy(appt);
  return by === 'client' || by === null;
}

export function isBusinessProposedReschedule(appt: RequestFields): boolean {
  return hasPendingReschedule(appt) && rescheduleProposedBy(appt) === 'business';
}

/**
 * Filtrul 'De decis' pentru salon: cereri noi (pending) sau reprogramari cerute de client.
 * Propunerile facute de salon asteapta raspunsul clientului — nu apar aici ca decizie a salonului.
 */
export function needsDecision(appt: RequestFields): boolean {
  return appt.status === 'pending' || isClientProposedReschedule(appt);
}

/** Salonul poate propune alta ora doar daca clientul are cont in aplicatie. */
export function canBusinessProposeReschedule(appt: Pick<Appointment, 'client_user_id' | 'status'>): boolean {
  return Boolean(appt.client_user_id) && (appt.status === 'pending' || appt.status === 'approved');
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
