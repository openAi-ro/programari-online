import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  appointmentEventId,
  deleteEvent,
  eventToBlock,
  exchangeCode,
  GoogleApiError,
  googleFetch,
  hasCalendarWriteScope,
  isAppointmentEventId,
  isTokenFresh,
  listEvents,
  mapLimit,
  refreshAccessToken,
  SyncTokenExpiredError,
  upsertAppointmentEvent,
  zonedDayStartUtc,
} from './googleCalendar.ts';

const noSleep = async () => {};
type Call = { url: string; method: string; body?: string };

function fakeFetch(responses: Array<Response | (() => Response)>, calls: Call[] = []): typeof fetch {
  let i = 0;
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string | undefined });
    const r = responses[Math.min(i++, responses.length - 1)];
    return Promise.resolve(typeof r === 'function' ? r() : r.clone());
  }) as typeof fetch;
}
const json = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.test('appointmentEventId is valid base32hex and deterministic', () => {
  const id = appointmentEventId('0E1D5765-4741-4685-97aa-50bb2ded3f59');
  assertEquals(id, 'prg0e1d5765474146859' + '7aa50bb2ded3f59');
  assert(/^[a-v0-9]{5,1024}$/.test(id));
  assertEquals(appointmentEventId('0e1d5765-4741-4685-97aa-50bb2ded3f59'), id);
  assert(isAppointmentEventId(id));
  assert(!isAppointmentEventId('abc123'));
});

Deno.test('googleFetch retries 429/5xx then succeeds', async () => {
  const calls: Call[] = [];
  const f = fakeFetch([json(429), json(503), json(200, { ok: 1 })], calls);
  const res = await googleFetch('https://x', {}, { fetchImpl: f, sleep: noSleep });
  assertEquals(res.status, 200);
  assertEquals(calls.length, 3);
});

Deno.test('googleFetch retries 403 rateLimitExceeded but not plain 403', async () => {
  const c1: Call[] = [];
  await googleFetch('https://x', {}, {
    fetchImpl: fakeFetch([json(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }), json(200)], c1),
    sleep: noSleep,
  });
  assertEquals(c1.length, 2);
  const c2: Call[] = [];
  const r = await googleFetch('https://x', {}, { fetchImpl: fakeFetch([json(403, { error: 'forbidden' })], c2), sleep: noSleep });
  assertEquals(r.status, 403);
  assertEquals(c2.length, 1);
});

Deno.test('googleFetch gives up after retries', async () => {
  const calls: Call[] = [];
  const r = await googleFetch('https://x', {}, { fetchImpl: fakeFetch([json(500)], calls), sleep: noSleep, retries: 2 });
  assertEquals(r.status, 500);
  assertEquals(calls.length, 3);
});

Deno.test('refreshAccessToken: invalid_grant flagged, success has expiry', async () => {
  const bad = await refreshAccessToken({ clientId: 'a', clientSecret: 'b' }, 'r', {
    fetchImpl: fakeFetch([json(400, { error: 'invalid_grant' })]),
    sleep: noSleep,
  });
  assertEquals(bad.ok, false);
  if (!bad.ok) assertEquals(bad.invalidGrant, true);
  const good = await refreshAccessToken({ clientId: 'a', clientSecret: 'b' }, 'r', {
    fetchImpl: fakeFetch([json(200, { access_token: 'tok', expires_in: 3599 })]),
    sleep: noSleep,
  });
  assert(good.ok);
  if (good.ok) assert(good.expiresAt.getTime() > Date.now() + 3_500_000);
});

Deno.test('isTokenFresh needs > 2 min left', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  assertEquals(isTokenFresh('2026-10-22T12:10:00Z', now), true);
  assertEquals(isTokenFresh('2026-10-22T12:01:00Z', now), false);
  assertEquals(isTokenFresh(null, now), false);
});

Deno.test('listEvents: incremental uses syncToken only, returns nextSyncToken', async () => {
  const calls: Call[] = [];
  const f = fakeFetch([json(200, { items: [{ id: 'a' }], nextPageToken: 'p2' }), json(200, { items: [{ id: 'b' }], nextSyncToken: 'S2' })], calls);
  const r = await listEvents('t', 'primary', { syncToken: 'S1', timeMin: 'x' }, { fetchImpl: f, sleep: noSleep });
  assertEquals(r.items.map((e) => e.id), ['a', 'b']);
  assertEquals(r.nextSyncToken, 'S2');
  const u = new URL(calls[0].url);
  assertEquals(u.searchParams.get('syncToken'), 'S1');
  assertEquals(u.searchParams.get('timeMin'), null);
  assertEquals(u.searchParams.get('orderBy'), null);
  assertEquals(new URL(calls[1].url).searchParams.get('pageToken'), 'p2');
});

Deno.test('listEvents: 410 with syncToken → SyncTokenExpiredError', async () => {
  await assertRejects(
    () => listEvents('t', 'primary', { syncToken: 'old' }, { fetchImpl: fakeFetch([json(410)]), sleep: noSleep }),
    SyncTokenExpiredError,
  );
});

Deno.test('upsertAppointmentEvent: new → POST with deterministic id', async () => {
  const calls: Call[] = [];
  const id = await upsertAppointmentEvent('t', 'primary', '11111111-2222-3333-4444-555555555555', null, { summary: 's' }, {
    fetchImpl: fakeFetch([json(200, { id: 'x' })], calls),
    sleep: noSleep,
  });
  assertEquals(id, 'prg11111111222233334444555555555555');
  assertEquals(calls[0].method, 'POST');
  assertEquals(JSON.parse(calls[0].body!).id, id);
});

Deno.test('upsertAppointmentEvent: 409 (retry/re-approve) → PATCH same id, no duplicate', async () => {
  const calls: Call[] = [];
  const id = await upsertAppointmentEvent('t', 'primary', '11111111-2222-3333-4444-555555555555', null, { summary: 's' }, {
    fetchImpl: fakeFetch([json(409), json(200)], calls),
    sleep: noSleep,
  });
  assertEquals(id, 'prg11111111222233334444555555555555');
  assertEquals(calls.map((c) => c.method), ['POST', 'PATCH']);
  assertEquals(JSON.parse(calls[1].body!).status, 'confirmed');
});

Deno.test('upsertAppointmentEvent: legacy linked id → PATCH it; 404 → recreate', async () => {
  const c1: Call[] = [];
  assertEquals(
    await upsertAppointmentEvent('t', 'primary', '11111111-2222-3333-4444-555555555555', 'legacy1', {}, { fetchImpl: fakeFetch([json(200)], c1), sleep: noSleep }),
    'legacy1',
  );
  assertEquals(c1.length, 1);
  const c2: Call[] = [];
  const id = await upsertAppointmentEvent('t', 'primary', '11111111-2222-3333-4444-555555555555', 'legacy1', {}, {
    fetchImpl: fakeFetch([json(404), json(200)], c2),
    sleep: noSleep,
  });
  assertEquals(id, 'prg11111111222233334444555555555555');
  assertEquals(c2.map((c) => c.method), ['PATCH', 'POST']);
});

Deno.test('deleteEvent tolerates 404/410, throws on 403', async () => {
  await deleteEvent('t', 'primary', 'e', { fetchImpl: fakeFetch([json(410)]), sleep: noSleep });
  await deleteEvent('t', 'primary', 'e', { fetchImpl: fakeFetch([new Response(null, { status: 204 })]), sleep: noSleep });
  await assertRejects(() => deleteEvent('t', 'primary', 'e', { fetchImpl: fakeFetch([json(403)]), sleep: noSleep }));
});

Deno.test('mapLimit keeps order, caps concurrency, captures failures', async () => {
  let active = 0;
  let peak = 0;
  const r = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((res) => setTimeout(res, 5));
    active -= 1;
    if (n === 3) throw new Error('boom');
    return n * 2;
  });
  assertEquals(peak, 5);
  assertEquals(r[0], { status: 'fulfilled', value: 2 });
  assertEquals(r[2].status, 'rejected');
  assertEquals(r.length, 12);
  assertEquals((await mapLimit([], 5, () => Promise.resolve(1))).length, 0);
});

Deno.test('eventToBlock: timed, all-day, cancelled, transparent, own', () => {
  const own = (id: string) => isAppointmentEventId(id);
  const timed = eventToBlock({ id: 'g1', start: { dateTime: '2026-11-01T10:00:00+02:00' }, end: { dateTime: '2026-11-01T11:00:00+02:00' } }, 'b', 'Europe/Bucharest', own);
  assertEquals(timed?.start_at, '2026-11-01T10:00:00+02:00');
  const allDay = eventToBlock({ id: 'g2', start: { date: '2026-11-02' }, end: { date: '2026-11-03' } }, 'b', 'Europe/Bucharest', own);
  assertEquals(allDay?.start_at, '2026-11-01T22:00:00.000Z');
  assertEquals(allDay?.end_at, '2026-11-02T22:00:00.000Z');
  assertEquals(eventToBlock({ id: 'g3', status: 'cancelled' }, 'b', 'UTC', own), null);
  assertEquals(eventToBlock({ id: 'g4', transparency: 'transparent', start: { dateTime: 'x' }, end: { dateTime: 'y' } }, 'b', 'UTC', own), null);
  assertEquals(eventToBlock({ id: appointmentEventId('11111111-2222-3333-4444-555555555555'), start: { dateTime: 'x' }, end: { dateTime: 'y' } }, 'b', 'UTC', own), null);
});

Deno.test('zonedDayStartUtc across DST (Bucharest)', () => {
  assertEquals(zonedDayStartUtc('2026-10-25', 'Europe/Bucharest').toISOString(), '2026-10-24T21:00:00.000Z');
  assertEquals(zonedDayStartUtc('2026-10-26', 'Europe/Bucharest').toISOString(), '2026-10-25T22:00:00.000Z');
  assertEquals(zonedDayStartUtc('2026-03-29', 'Europe/Bucharest').toISOString(), '2026-03-28T22:00:00.000Z');
  assertEquals(zonedDayStartUtc('2026-03-30', 'Europe/Bucharest').toISOString(), '2026-03-29T21:00:00.000Z');
  assertEquals(zonedDayStartUtc('2026-07-01', 'UTC').toISOString(), '2026-07-01T00:00:00.000Z');
});

const SCOPE_403 = {
  error: {
    code: 403,
    status: 'PERMISSION_DENIED',
    errors: [{ reason: 'insufficientPermissions' }],
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
  },
};

Deno.test('listEvents 403 without calendar scope → GoogleApiError.insufficientScope with Google reason', async () => {
  const err = await assertRejects(
    () => listEvents('t', 'primary', { timeMin: 'a', timeMax: 'b' }, { fetchImpl: fakeFetch([json(403, SCOPE_403)]), sleep: noSleep }),
    GoogleApiError,
  );
  assert(err.insufficientScope);
  assertEquals(err.message, 'google_list_failed_403:ACCESS_TOKEN_SCOPE_INSUFFICIENT');
});

Deno.test('create 403 for another reason is not a scope error; reason still reported', async () => {
  const body = { error: { code: 403, errors: [{ reason: 'accessNotConfigured' }] } };
  const err = await assertRejects(
    () => upsertAppointmentEvent('t', 'primary', '0e1d5765-4741-4685-97aa-50bb2ded3f59', null, {}, {
      fetchImpl: fakeFetch([json(403, body)]),
      sleep: noSleep,
    }),
    GoogleApiError,
  );
  assert(!err.insufficientScope);
  assertEquals(err.message, 'google_create_failed_403:accessNotConfigured');
  const plain = await assertRejects(
    () => deleteEvent('t', 'primary', 'x', { fetchImpl: fakeFetch([new Response('', { status: 500 })]), sleep: noSleep }),
    GoogleApiError,
  );
  assertEquals(plain.message, 'google_delete_failed_500');
});

Deno.test('hasCalendarWriteScope: readonly alone is not enough', () => {
  assert(hasCalendarWriteScope('openid https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.readonly'));
  assert(hasCalendarWriteScope('https://www.googleapis.com/auth/calendar'));
  assert(!hasCalendarWriteScope('https://www.googleapis.com/auth/calendar.events.readonly'));
  assert(!hasCalendarWriteScope(''));
  assert(!hasCalendarWriteScope(undefined));
});

Deno.test('exchangeCode rejects a grant without calendar scope', async () => {
  const env = { clientId: 'c', clientSecret: 's', redirectUri: 'r' };
  const token = (scope: string) => json(200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope });
  const denied = await exchangeCode(env, 'code', {
    fetchImpl: fakeFetch([token('https://www.googleapis.com/auth/calendar.events.readonly')]),
    sleep: noSleep,
  });
  assertEquals(denied, { error: 'insufficient_scope' });
  const ok = await exchangeCode(env, 'code', {
    fetchImpl: fakeFetch([token('https://www.googleapis.com/auth/calendar.events')]),
    sleep: noSleep,
  });
  assert('accessToken' in ok && ok.refreshToken === 'r');
});
