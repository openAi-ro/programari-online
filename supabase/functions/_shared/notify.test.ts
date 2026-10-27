// Run: deno test --allow-env --allow-net supabase/functions/_shared/
import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  logNotification,
  messageNewPendingRequest,
  sendEmail,
  maskRecipient,
  messageApproved,
  messageWaitlistSpot,
  notifyClientChannels,
  resolveClientPhone,
  sendWhatsApp,
  whatsappUserHint,
  WA_TEMPLATE_VARS,
} from './notify.ts';
import { extractStatuses, shouldApplyStatus, verifyMetaSignature } from './whatsappWebhook.ts';

const ENV = [
  'WHATSAPP_PROVIDER', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TPL_CONFIRMED',
  'WHATSAPP_TPL_WAITLIST', 'WHATSAPP_TPL_LANG', 'TWILIO_ACCOUNT_SID', 'BREVO_API_KEY', 'EMAIL_FROM',
];
function resetEnv() { for (const k of ENV) Deno.env.delete(k); }
function metaEnv() {
  Deno.env.set('WHATSAPP_PROVIDER', 'meta');
  Deno.env.set('WHATSAPP_ACCESS_TOKEN', 'test-token-not-real');
  Deno.env.set('WHATSAPP_PHONE_NUMBER_ID', 'bogus-phone-id');
}
type Call = { url: string; body: Record<string, unknown> };
function mockFetch(status: number, body: unknown): { calls: Call[]; restore: () => void } {
  const orig = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : {} });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

Deno.test('stub (no secrets) is NOT ok and says not configured', async () => {
  resetEnv();
  const r = await sendWhatsApp('0712345900', 'hi');
  assertEquals(r.ok, false);
  assertEquals(r.stub, true);
  assertEquals(r.outcome, 'stub');
  assertStringIncludes(whatsappUserHint(r, 'en'), 'not configured');
});

Deno.test('invalid phone -> invalid_phone outcome', async () => {
  resetEnv(); metaEnv();
  const r = await sendWhatsApp('12', 'hi');
  assertEquals(r.ok, false);
  assertEquals(r.outcome, 'invalid_phone');
});

Deno.test('no template configured -> free-form text (no regression), wamid parsed', async () => {
  resetEnv(); metaEnv();
  const m = mockFetch(200, { messages: [{ id: 'wamid.ABC' }] });
  try {
    const copy = messageApproved('Salon X', '19 oct. 2026, 10:00', 'ro');
    const [r] = await notifyClientChannels({ email: null, phone: '0712345900', subject: copy.subject, text: copy.text, wa: copy.wa });
    assertEquals(m.calls.length, 1);
    assertStringIncludes(m.calls[0].url, '/v21.0/bogus-phone-id/messages');
    assertEquals(m.calls[0].body.type, 'text');
    assertEquals(m.calls[0].body.to, '40712345900');
    assertEquals((m.calls[0].body.text as { body: string }).body, copy.text);
    assertEquals(r.ok, true);
    assertEquals(r.outcome, 'accepted');
    assertEquals(r.messageId, 'wamid.ABC');
  } finally { m.restore(); }
});

Deno.test('template configured -> template with body vars in fixed order, lang ro', async () => {
  resetEnv(); metaEnv();
  Deno.env.set('WHATSAPP_TPL_CONFIRMED', 'programare_confirmata');
  const m = mockFetch(200, { messages: [{ id: 'wamid.T1' }] });
  try {
    const copy = messageApproved('Salon\nX', '19 oct. 2026, 10:00', 'en'); // en client still gets RO template
    const r = await sendWhatsApp('+40712345900', copy.text, { template: copy.wa });
    const t = m.calls[0].body.template as { name: string; language: { code: string }; components: { type: string; parameters: { text: string }[] }[] };
    assertEquals(m.calls[0].body.type, 'template');
    assertEquals(t.name, 'programare_confirmata');
    assertEquals(t.language.code, 'ro');
    assertEquals(t.components[0].parameters.map((p) => p.text), ['Salon X', '19 oct. 2026, 10:00']);
    assertEquals(t.components[0].parameters.length, WA_TEMPLATE_VARS.CONFIRMED.length);
    assertEquals(r.template, 'programare_confirmata');
    assertEquals(r.ok, true);
  } finally { m.restore(); }
});

Deno.test('waitlist template has 3 vars (business, date, link)', async () => {
  resetEnv(); metaEnv();
  Deno.env.set('WHATSAPP_TPL_WAITLIST', 'loc_eliberat');
  const m = mockFetch(200, { messages: [{ id: 'wamid.W' }] });
  try {
    const c = messageWaitlistSpot('Salon X', '2026-10-20', 'https://programari.expo.app/b/ABC', 'ro');
    await sendWhatsApp('0712345900', c.text, { template: c.wa });
    const t = m.calls[0].body.template as { components: { parameters: { text: string }[] }[] };
    assertEquals(t.components[0].parameters.map((p) => p.text), ['Salon X', '20 octombrie 2026', 'https://programari.expo.app/b/ABC']);
  } finally { m.restore(); }
});

Deno.test('bogus phone-number-id -> real failure with Meta code 100 + useful hint', async () => {
  resetEnv(); metaEnv();
  const m = mockFetch(400, { error: { message: "Unsupported post request. Object with ID 'bogus-phone-id' does not exist, cannot be loaded due to missing permissions", type: 'GraphMethodException', code: 100, error_subcode: 33 } });
  try {
    const r = await sendWhatsApp('0712345900', 'hi');
    assertEquals(r.ok, false);
    assertEquals(r.stub, undefined);
    assertEquals(r.outcome, 'failed');
    assertEquals(r.errorCode, '100');
    assertEquals(r.status, 400);
    assertStringIncludes(whatsappUserHint(r, 'en'), 'WHATSAPP_PHONE_NUMBER_ID');
  } finally { m.restore(); }
});

Deno.test('expired token (190) and test-number recipient (131030) hints', async () => {
  resetEnv(); metaEnv();
  let m = mockFetch(401, { error: { message: 'Error validating access token: Session has expired', code: 190 } });
  try { const r = await sendWhatsApp('0712345900', 'hi'); assertEquals(r.errorCode, '190'); assertStringIncludes(whatsappUserHint(r, 'en'), 'expired'); } finally { m.restore(); }
  m = mockFetch(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030 } });
  try { const r = await sendWhatsApp('0712345900', 'hi'); assertEquals(r.errorCode, '131030'); assertStringIncludes(whatsappUserHint(r, 'en'), 'allowed list'); } finally { m.restore(); }
});

Deno.test('email stub is not ok', async () => {
  resetEnv();
  const [r] = await notifyClientChannels({ email: 'a@b.ro', phone: null, subject: 's', text: 't' });
  assertEquals(r.ok, false); assertEquals(r.stub, true);
});

function fakeAdmin(profilePhone: string | null) {
  const inserts: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: () => Promise.resolve({ data: table === 'profiles' ? { phone: profilePhone } : null }),
        insert: (row: Record<string, unknown>) => { inserts.push({ table, ...row }); return Promise.resolve({ error: null }); },
      };
    },
  };
  return { admin, inserts };
}

Deno.test('phone fallback: booking phone, else profile phone', async () => {
  const { admin } = fakeAdmin('+40712345900');
  assertEquals(await resolveClientPhone(admin, '0711111111', 'u1'), '0711111111');
  assertEquals(await resolveClientPhone(admin, null, 'u1'), '+40712345900');
  assertEquals(await resolveClientPhone(admin, '  ', 'u1'), '+40712345900');
  assertEquals(await resolveClientPhone(admin, null, null), null);
});

Deno.test('notification_log row is masked and carries status/error', async () => {
  resetEnv(); metaEnv();
  const { admin, inserts } = fakeAdmin(null);
  const m = mockFetch(400, { error: { message: '(#131030) Recipient phone number not in allowed list', code: 131030 } });
  try {
    await notifyClientChannels({ email: null, phone: '0712345900', subject: 's', text: 't', log: { admin, type: 'CONFIRMED', businessId: 'b1', appointmentId: 'a1' } });
  } finally { m.restore(); }
  assertEquals(inserts.length, 1);
  const row = inserts[0];
  assertEquals(row.table, 'notification_log');
  assertEquals(row.to_masked, '+407***900');
  assertEquals(row.status, 'failed');
  assertEquals(row.error_code, '131030');
  assertEquals(row.business_id, 'b1');
  assertEquals(maskRecipient('danescu@yahoo.com'), 'da***@yahoo.com');
});

// ---- webhook helpers ----
async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.test('webhook signature verification', async () => {
  const body = '{"a":1}';
  assert(await verifyMetaSignature(body, await sign(body, 's3cret'), 's3cret'));
  assert(!(await verifyMetaSignature(body, await sign(body, 'other'), 's3cret')));
  assert(!(await verifyMetaSignature(body, null, 's3cret')));
});

Deno.test('webhook statuses: failed 131047 extracted, order rules', () => {
  const payload = { entry: [{ changes: [{ value: { statuses: [
    { id: 'wamid.1', status: 'delivered' },
    { id: 'wamid.2', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' } }] },
  ] } }] }] };
  const s = extractStatuses(payload);
  assertEquals(s.length, 2);
  assertEquals(s[1].errorCode, '131047');
  assertStringIncludes(s[1].errorMessage ?? '', 'Re-engagement');
  assert(shouldApplyStatus('accepted', 'delivered'));
  assert(!shouldApplyStatus('read', 'delivered'));
  assert(shouldApplyStatus('read', 'failed'));
  assert(!shouldApplyStatus('failed', 'read'));
  assertEquals(extractStatuses({ entry: [{ changes: [{ value: { messages: [{ id: 'x' }] } }] }] }).length, 0);
});

Deno.test('email: no BREVO_API_KEY -> stub email_not_configured', async () => {
  resetEnv();
  const r = await sendEmail('a@b.ro', 's', 't');
  assertEquals(r.ok, false);
  assertEquals(r.error, 'email_not_configured');
});

Deno.test('email: Brevo API payload + messageId parsed', async () => {
  resetEnv();
  Deno.env.set('BREVO_API_KEY', 'test-key-not-real');
  const m = mockFetch(201, { messageId: '<abc@smtp-relay.mailin.fr>' });
  try {
    const r = await sendEmail('a@b.ro', 'Subj', 'Body');
    assertEquals(r.ok, true);
    assertEquals(r.messageId, '<abc@smtp-relay.mailin.fr>');
    assertEquals(m.calls[0].url, 'https://api.brevo.com/v3/smtp/email');
    assertEquals(m.calls[0].body.to, [{ email: 'a@b.ro' }]);
    assertEquals((m.calls[0].body.sender as { email: string }).email, 'programari@promixt.ro');
  } finally { m.restore(); resetEnv(); }
});

Deno.test('owner pending: template when WHATSAPP_TPL_OWNER_PENDING set, 3 vars', async () => {
  resetEnv(); metaEnv();
  Deno.env.set('WHATSAPP_TPL_OWNER_PENDING', 'programare_noua_in_asteptare');
  const m = mockFetch(200, { messages: [{ id: 'wamid.OP' }] });
  try {
    const copy = messageNewPendingRequest('Salon X', 'ana@x.ro', '21 oct. 2026, 10:00', 'ro');
    assertEquals(copy.wa.vars.length, WA_TEMPLATE_VARS.OWNER_PENDING.length);
    await notifyClientChannels({ email: null, phone: '0712345900', subject: copy.subject, text: copy.text, wa: copy.wa });
    assertEquals(m.calls[0].body.type, 'template');
  } finally { m.restore(); Deno.env.delete('WHATSAPP_TPL_OWNER_PENDING'); resetEnv(); }
});

Deno.test('reschedule copy: RO/EN, MOVED template only on accept', async () => {
  const { messageRescheduleRequested, messageRescheduleAccepted, messageRescheduleDeclined, messageRescheduleExpired, messageCancelledByBusiness } = await import('./notify.ts');
  const req = messageRescheduleRequested('Salon X', 'ana@x.ro', '3 nov. 15:00', '4 nov. 16:00', 'ro');
  assertStringIncludes(req.text, '3 nov. 15:00 → 4 nov. 16:00');
  assertStringIncludes(messageRescheduleRequested('Salon X', 'a', 'A', 'B', 'en').text, 'accept or decline');
  const acc = messageRescheduleAccepted('Salon X', '4 nov. 16:00', 'ro');
  assertEquals(acc.wa, { key: 'MOVED', vars: ['Salon X', '4 nov. 16:00'] });
  const dec = messageRescheduleDeclined('Salon X', '3 nov. 15:00', 'https://programari.expo.app/my-appointments', 'ro');
  assertStringIncludes(dec.text, 'rămâne pe 3 nov. 15:00');
  assertStringIncludes(dec.text, '/my-appointments');
  assert(!('wa' in dec));
  assertStringIncludes(messageRescheduleExpired('Salon X', 'Nov 3', 'en').text, 'stays on Nov 3');
  const c = messageCancelledByBusiness('Salon X', '3 nov.', 'Boală', 'https://x/b/C', 'ro');
  assertStringIncludes(c.text, 'Motiv: Boală');
});
