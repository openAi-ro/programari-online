import { assertEquals } from 'jsr:@std/assert@1';
import { authorizeCron, checkWebhookSecret, safeEqual } from './secret-auth.ts';

const req = (h: Record<string, string>) => new Request('http://x', { method: 'POST', headers: h });

Deno.test('safeEqual', () => {
  assertEquals(safeEqual('abc', 'abc'), true);
  assertEquals(safeEqual('abc', 'abd'), false);
  assertEquals(safeEqual('abc', 'abcd'), false);
  assertEquals(safeEqual(null, 'a'), false);
});

Deno.test('authorizeCron fails closed without CRON_SECRET', () => {
  Deno.env.delete('CRON_SECRET');
  const r = authorizeCron(req({ 'x-cron-secret': 'anything' }));
  assertEquals(r.ok ? 0 : r.status, 500);
});

Deno.test('authorizeCron header / service role / reject', () => {
  Deno.env.set('CRON_SECRET', 's3cret');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'svc');
  assertEquals(authorizeCron(req({ 'x-cron-secret': 's3cret' })).ok, true);
  assertEquals(authorizeCron(req({ authorization: 'Bearer svc' })).ok, true);
  const bad = authorizeCron(req({ 'x-cron-secret': 'nope' }));
  assertEquals(bad.ok ? 0 : bad.status, 401);
  const none = authorizeCron(req({}));
  assertEquals(none.ok ? 0 : none.status, 401);
});

Deno.test('checkWebhookSecret', () => {
  Deno.env.delete('WEBHOOK_SECRET');
  assertEquals(checkWebhookSecret(req({ 'x-webhook-secret': 'x' })), 'missing');
  Deno.env.set('WEBHOOK_SECRET', 'w');
  assertEquals(checkWebhookSecret(req({ 'x-webhook-secret': 'w' })), 'ok');
  assertEquals(checkWebhookSecret(req({ 'x-webhook-secret': 'x' })), 'no_match');
  assertEquals(checkWebhookSecret(req({})), 'no_match');
});
