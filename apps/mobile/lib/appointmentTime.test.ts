import {
  activeUpcomingAppointments,
  hasEnded,
  pastAppointments,
  upcomingAppointments,
} from './appointmentTime';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const now = new Date('2026-10-26T18:00:00.000Z');
const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
const row = (id: string, startMin: number, endMin: number, status = 'approved') => ({
  id,
  status,
  start_at: at(startMin),
  end_at: at(endMin),
});

const endsNow = row('endsNow', -30, 0);
const ongoing = row('ongoing', -10, 20);
const later = row('later', 60, 90);
const soon = row('soon', 5, 35, 'pending');
const yesterday = row('yesterday', -1440, -1410, 'cancelled');
const lastHour = row('lastHour', -90, -60, 'completed');
const rows = [yesterday, later, endsNow, soon, ongoing, lastHour];

assert(hasEnded(endsNow, now), 'ending exactly now is past');
assert(!hasEnded(ongoing, now), 'ongoing is current');
assert(hasEnded(endsNow, now.getTime()), 'accepts epoch ms');

const up = upcomingAppointments(rows, now).map((r) => r.id).join(',');
assert(up === 'ongoing,soon,later', `upcoming ascending: ${up}`);
const past = pastAppointments(rows, now).map((r) => r.id).join(',');
assert(past === 'endsNow,lastHour,yesterday', `past descending: ${past}`);
assert(
  upcomingAppointments(rows, now).length + pastAppointments(rows, now).length === rows.length,
  'every row is in exactly one list'
);
assert(rows[0].id === 'yesterday', 'input not mutated');

// „Viitoare” la client: anulatele/respinsele viitoare lipsesc; pending rămâne (audit C-51).
const futureCancelled = row('futureCancelled', 120, 150, 'cancelled');
const futureRejected = row('futureRejected', 180, 210, 'rejected');
const activeIds = activeUpcomingAppointments(
  [...rows, futureCancelled, futureRejected],
  now
)
  .map((r) => r.id)
  .join(',');
assert(activeIds === 'ongoing,soon,later', `active upcoming only: ${activeIds}`);

console.log('appointmentTime: ok');
