// End-to-end of the Settings "test WhatsApp" handler with all network mocked.
// Run: deno test --allow-env --allow-net supabase/functions/test-whatsapp/
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

type Handler = (req: Request) => Promise<Response>;
let handler: Handler | null = null;
// Capture the handler instead of starting a server.
(Deno as unknown as { serve: (h: Handler) => void }).serve = (h: Handler) => { handler = h; };

Deno.env.set('SUPABASE_URL', 'https://fake.supabase.local');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-fake');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-fake');
await import('./index.ts');

const logRows: unknown[] = [];
let metaCalls: Record<string, unknown>[] = [];
let metaResponse: { status: number; body: unknown } = { status: 200, body: {} };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  const bodyText = init?.body ? String(init.body) : input instanceof Request ? await input.clone().text() : '';
  if (url.includes('/auth/v1/user')) {
    return new Response(JSON.stringify({ id: 'u-rafael', aud: 'authenticated', phone: '' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/rest/v1/profiles')) {
    return new Response(JSON.stringify({ phone: '+40712345900', email: 'x@y.ro', notify_whatsapp: true, language: 'en' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.includes('/rest/v1/notification_log') && method === 'POST') {
    logRows.push(JSON.parse(bodyText));
    return new Response('', { status: 201 });
  }
  if (url.includes('graph.facebook.com')) {
    metaCalls.push(JSON.parse(bodyText));
    return new Response(JSON.stringify(metaResponse.body), { status: metaResponse.status });
  }
  return realFetch(input, init);
}) as typeof fetch;

async function call() {
  const res = await handler!(new Request('https://x/test-whatsapp', { method: 'POST', headers: { Authorization: 'Bearer user-jwt-fake', 'Content-Type': 'application/json' }, body: '{}' }));
  return { status: res.status, body: await res.json() };
}

Deno.test('stub mode: app gets ok:false + stub + configuration hint (no fake success)', async () => {
  for (const k of ['WHATSAPP_PROVIDER', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID']) Deno.env.delete(k);
  metaCalls = [];
  const r = await call();
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, false);
  assertEquals(r.body.result.stub, true);
  assertStringIncludes(r.body.hint, 'WHATSAPP_STUB');
  assertEquals(metaCalls.length, 0);
});

Deno.test('free-form mode: Meta accepts -> ok:true with wamid, logged', async () => {
  Deno.env.set('WHATSAPP_PROVIDER', 'meta');
  Deno.env.set('WHATSAPP_ACCESS_TOKEN', 'tok-fake');
  Deno.env.set('WHATSAPP_PHONE_NUMBER_ID', '123456789');
  metaCalls = []; logRows.length = 0;
  metaResponse = { status: 200, body: { messages: [{ id: 'wamid.TEST' }] } };
  const r = await call();
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, true);
  assertEquals(r.body.result.messageId, 'wamid.TEST');
  assertEquals(metaCalls[0].type, 'text');
  assertEquals((logRows[0] as { status: string; type: string; wamid: string }).status, 'accepted');
  assertEquals((logRows[0] as { wamid: string }).wamid, 'wamid.TEST');
});

Deno.test('bogus phone-number-id: app receives the real Meta error (200 body, ok:false, code 100)', async () => {
  Deno.env.set('WHATSAPP_PHONE_NUMBER_ID', 'bogus-id');
  logRows.length = 0;
  metaResponse = { status: 400, body: { error: { message: "Unsupported post request. Object with ID 'bogus-id' does not exist", code: 100 } } };
  const r = await call();
  assertEquals(r.status, 200);
  assertEquals(r.body.ok, false);
  assertEquals(r.body.error, 'whatsapp_send_failed');
  assertEquals(r.body.result.errorCode, '100');
  assertStringIncludes(r.body.hint, 'WHATSAPP_PHONE_NUMBER_ID');
  assertStringIncludes(r.body.hint, '(Meta 100)');
  assertEquals((logRows[0] as { status: string }).status, 'failed');
});
