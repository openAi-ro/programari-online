import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { otpLimitHint, parseReserveVerdict } from './limits.ts';

Deno.test('rezervare reușită', () => {
  assertEquals(parseReserveVerdict({ ok: true, id: 'abc' }), { ok: true, id: 'abc' });
});

Deno.test('limită pe număr, cu timp de așteptare', () => {
  assertEquals(parseReserveVerdict({ ok: false, error: 'phone_daily_limit', retry_after_s: 3600.2 }), {
    ok: false,
    error: 'phone_daily_limit',
    retryAfterS: 3601,
  });
});

Deno.test('răspuns necunoscut -> null (nu se trimite cod)', () => {
  assertEquals(parseReserveVerdict(null), null);
  assertEquals(parseReserveVerdict({ ok: false, error: 'altceva' }), null);
  assertEquals(parseReserveVerdict({ ok: true }), null);
});

Deno.test('mesaje RO/EN', () => {
  assertStringIncludes(otpLimitHint('cooldown', 42, 'ro'), '42 de secunde');
  assertStringIncludes(otpLimitHint('phone_daily_limit', 7200, 'ro'), '2 ore');
  assertStringIncludes(otpLimitHint('ip_hourly_limit', 600, 'en'), '10 minutes');
  assertStringIncludes(otpLimitHint('ip_daily_limit', 600, 'en'), 'network');
});
