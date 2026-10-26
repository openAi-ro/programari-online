/**
 * Current vs past appointments, shared by the client list (my-appointments) and the business
 * list (Cereri / Programări). An appointment is past once its end time is reached; one that is
 * in progress is still current.
 */
type Timed = { start_at: string; end_at: string };

function toMs(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

export function hasEnded(appt: Pick<Timed, 'end_at'>, now: Date | number): boolean {
  return new Date(appt.end_at).getTime() <= toMs(now);
}

/** Not yet ended, soonest first. */
export function upcomingAppointments<T extends Timed>(rows: T[], now: Date | number): T[] {
  return rows
    .filter((r) => !hasEnded(r, now))
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());
}

/** Ended (any status: completed, no-show, cancelled, rejected), newest first. */
export function pastAppointments<T extends Timed>(rows: T[], now: Date | number): T[] {
  return rows
    .filter((r) => hasEnded(r, now))
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime());
}
