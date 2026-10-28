/**
 * Run: npx tsx lib/quickAddRules.test.ts
 * from apps/mobile
 */
import {
  appointmentClientParts,
  appointmentContactParts,
  buildQuickAddPayload,
  canNotifyClient,
  quickAddDays,
  quickAddQueryReady,
  type BusinessClientContact,
} from './quickAddRules';
import { isBusinessCreatedInsert, reminderSkipReason } from '../../../supabase/functions/_shared/businessCreated';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('quickAddRules tests\n');
const base = { serviceIds: ['a', 'b'], slotStartUtc: '2026-10-30T07:00:00.000Z', picked: null, name: ' Ion ', phone: '', email: '' };

let r = buildQuickAddPayload({ ...base, phone: '0722 123 456' });
assert(r.error === null && r.payload?.p_client_phone === '+40722123456', 'phone-only normalizes to E.164', JSON.stringify(r));
assert(r.payload?.p_client_name === 'Ion', 'name trimmed');
assert(r.payload?.p_service_ids.join(',') === 'a,b', 'multi services kept in order');
assert(r.payload?.p_client_email === null, 'no email → null');

r = buildQuickAddPayload({ ...base, phone: '12' });
assert(r.error === 'invalid_phone', 'short phone rejected');
r = buildQuickAddPayload({ ...base, email: 'x@' });
assert(r.error === 'invalid_email', 'bad email rejected');
r = buildQuickAddPayload({ ...base });
assert(r.error === 'walkin_contact_required', 'no contact and no picked client rejected');
r = buildQuickAddPayload({ ...base, email: ' A@B.ro ' });
assert(r.error === null && r.payload?.p_client_email === 'a@b.ro', 'email-only ok, lowercased');
r = buildQuickAddPayload({ ...base, serviceIds: [], phone: '0722123456' });
assert(r.error === 'service_required', 'needs a service');
r = buildQuickAddPayload({ ...base, slotStartUtc: null, phone: '0722123456' });
assert(r.error === 'walkin_slot_required', 'needs a slot');

const card: BusinessClientContact = { businessClientId: 'bc1', clientUserId: null, displayName: 'Ana', phone: '+40733000000', email: null, visitCount: 2 };
r = buildQuickAddPayload({ ...base, picked: card });
assert(r.error === null && r.payload?.p_client_id === 'bc1' && r.payload.p_client_user_id === null, 'picked card → p_client_id');
const acct: BusinessClientContact = { businessClientId: null, clientUserId: 'u1', displayName: 'Dan', phone: null, email: 'd@x.ro', visitCount: 1 };
r = buildQuickAddPayload({ ...base, picked: acct });
assert(r.error === null && r.payload?.p_client_user_id === 'u1' && r.payload.p_client_id === null, 'picked account → p_client_user_id');

const now = new Date('2026-10-28T12:00:00Z');
assert(canNotifyClient('2026-10-28T12:30:00Z', now), 'future slot can notify');
assert(!canNotifyClient('2026-10-28T11:30:00Z', now), 'past slot cannot notify');
assert(!canNotifyClient(null, now), 'no slot cannot notify');

const days = quickAddDays('2026-10-28', 2, 3);
assert(days.length === 6 && days[0] === '2026-10-26' && days[5] === '2026-10-31', 'day strip past+future', days.join(','));
assert(quickAddDays('2026-03-29', 0, 1)[1] === '2026-03-30', 'DST day boundary ok');
assert(!quickAddQueryReady(' a ') && quickAddQueryReady('07'), 'query needs 2 chars');

assert(
  appointmentClientParts({ guestName: ' Ana ', businessClientName: 'Ana P', phone: '+40700000123' }).join('|') === 'Ana|+40700000123',
  'card: guest_name first, then phone',
);
assert(
  appointmentClientParts({ guestName: '', businessClientName: 'Ion', phone: '+40700000123', email: 'i@x.ro' }).join('|') === 'Ion|+40700000123|i@x.ro',
  'card: falls back to business_clients name',
);
assert(appointmentClientParts({ phone: '+40700000123' }).join('|') === '+40700000123', 'card: phone only when no name');
assert(appointmentClientParts({}).length === 0, 'card: nothing to show');
assert(
  appointmentContactParts({ guest_name: 'Test Rapid', client_phone: '+40700000123', client_email: null })[0] === 'Test Rapid',
  'list: guest name before phone',
);
assert(
  appointmentContactParts({ guest_name: null, business_client: { name: 'Ion' }, client_phone: null, client_email: 'i@x.ro' }).join('|') === 'Ion|i@x.ro',
  'list: business client name fallback',
);
assert(appointmentContactParts({ client_phone: null, client_email: null }).length === 0, 'list: nothing to show');

// Edge-function gates (supabase/functions/_shared/businessCreated.ts)
assert(isBusinessCreatedInsert('INSERT', { created_by: 'u' }), 'owner push skipped for business-created insert');
assert(!isBusinessCreatedInsert('INSERT', { created_by: null }), 'client booking still notifies owner');
assert(!isBusinessCreatedInsert('INSERT', { created_by: 'u' }, 'reschedule_requested'), 'reschedule reason still notifies');
assert(reminderSkipReason({ client_user_id: null, created_by: 'u', notify_client: false }) === 'business_no_notify', 'toggle OFF → no reminder');
assert(reminderSkipReason({ client_user_id: null, created_by: 'u', notify_client: true }) === null, 'toggle ON → reminder');
assert(reminderSkipReason({ client_user_id: 'o', client_is_member: true, notify_client: null }) === 'member_walkin', 'legacy owner-linked walk-in → no reminder');
assert(reminderSkipReason({ client_user_id: 'c', created_by: null, notify_client: null }) === null, 'self-booked client unchanged');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
