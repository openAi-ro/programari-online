// Run: deno test supabase/functions/send-reminders/
import { assertEquals } from 'jsr:@std/assert@1';
import {
  channelsToSend,
  failedChannels,
  isFirstAttempt,
  MAX_SEND_ATTEMPTS,
  shouldRetry,
} from './retry.ts';

Deno.test('first run sends every planned channel and the push', () => {
  assertEquals(channelsToSend(['email', 'whatsapp'], []), ['email', 'whatsapp']);
  assertEquals(isFirstAttempt([]), true);
});

Deno.test('a delivered channel is never sent again (no duplicates)', () => {
  const log = [
    { channel: 'email', status: 'accepted' },
    { channel: 'whatsapp', status: 'failed' },
  ];
  assertEquals(channelsToSend(['email', 'whatsapp'], log), ['whatsapp']);
  assertEquals(isFirstAttempt(log), false);
  // a failed attempt followed by a success is done too
  assertEquals(channelsToSend(['whatsapp'], [
    { channel: 'whatsapp', status: 'failed' },
    { channel: 'whatsapp', status: 'read' },
  ]), []);
});

Deno.test('stub and invalid_phone are final, not retried', () => {
  assertEquals(channelsToSend(['email', 'whatsapp'], [
    { channel: 'email', status: 'stub' },
    { channel: 'whatsapp', status: 'invalid_phone' },
  ]), []);
});

Deno.test('a failed channel is retried until MAX_SEND_ATTEMPTS', () => {
  const failed = (n: number) => Array.from({ length: n }, () => ({ channel: 'email', status: 'failed' }));
  assertEquals(MAX_SEND_ATTEMPTS, 3);
  assertEquals(channelsToSend(['email'], failed(2)), ['email']);
  assertEquals(channelsToSend(['email'], failed(3)), []);
  // flag released after attempt 1 and 2 fail, kept after attempt 3 fails
  assertEquals(shouldRetry(['email'], failed(0)), true);
  assertEquals(shouldRetry(['email'], failed(1)), true);
  assertEquals(shouldRetry(['email'], failed(2)), false);
  assertEquals(shouldRetry([], failed(1)), false);
});

Deno.test('failedChannels uses the logged status', () => {
  assertEquals(failedChannels([
    { ok: true, channel: 'email', outcome: 'accepted' },
    { ok: false, channel: 'whatsapp', outcome: 'failed' },
  ]), ['whatsapp']);
  assertEquals(failedChannels([
    { ok: false, stub: true, channel: 'whatsapp', outcome: 'stub' },
    { ok: false, channel: 'whatsapp', outcome: 'invalid_phone' },
    { ok: false, channel: 'email' },
  ]), ['email']);
});
