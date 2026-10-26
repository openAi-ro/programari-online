import { hasPendingReschedule, isOwnBusyRange, needsDecision, ownBusyKeys } from './rescheduleRequest';

function assert(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL: ${label}`);
}

const req = { requested_start_at: '2026-11-04T14:00:00Z', requested_end_at: '2026-11-04T14:30:00Z' };
const none = { requested_start_at: null, requested_end_at: null };

assert(hasPendingReschedule({ status: 'approved', ...req }), 'approved + request');
assert(!hasPendingReschedule({ status: 'cancelled', ...req }), 'cancelled ignores stale request');
assert(!hasPendingReschedule({ status: 'approved', ...none }), 'no request');
assert(needsDecision({ status: 'pending', ...none }), 'pending needs decision');
assert(needsDecision({ status: 'approved', ...req }), 'reschedule needs decision');
assert(!needsDecision({ status: 'approved', ...none }), 'plain approved does not');

const keys = ownBusyKeys({ start_at: '2026-11-03T13:00:00Z', end_at: '2026-11-03T13:30:00Z', ...req });
assert(isOwnBusyRange(keys, { startUtc: '2026-11-03T13:00:00.000Z', endUtc: '2026-11-03T13:30:00+00:00' }), 'own current range (format-agnostic)');
assert(isOwnBusyRange(keys, { startUtc: '2026-11-04T14:00:00Z', endUtc: '2026-11-04T14:30:00Z' }), 'own requested range');
assert(!isOwnBusyRange(keys, { startUtc: '2026-11-04T14:00:00Z', endUtc: '2026-11-04T15:00:00Z' }), 'other range');
console.log('rescheduleRequest: 9 ok');
