// Run: deno test supabase/functions/send-reminders/
import { assertEquals, assertStringIncludes, assert } from 'jsr:@std/assert@1';
import { isSoonDue, soonKind, soonWindow } from './windows.ts';
import { messageReminder, WA_TEMPLATE_VARS } from '../_shared/notify.ts';

const MIN = 60_000;
const now = Date.parse('2026-10-25T07:00:00Z'); // 09:00 Bucharest (UTC+2, after DST change)
const CRON_STEP = 5 * MIN;

/** First cron run (every 5 min, from `firstRun`) that picks the appointment, or null. */
function firstPick(startMs: number, confirmedMs: number, firstRun: number): number | null {
  for (let t = firstRun; t < startMs; t += CRON_STEP) {
    if (isSoonDue(startMs, confirmedMs, t)) return t;
  }
  return null;
}

Deno.test('window bounds', () => {
  const w = soonWindow(now);
  assertEquals(w.from, '2026-10-25T07:15:00.000Z');
  assertEquals(w.to, '2026-10-25T08:05:00.000Z');
  assertEquals(w.confirmedBefore, '2026-10-25T06:40:00.000Z');
});

Deno.test('normal booking (confirmed days ago) is reminded 60-65 min before, kind 1h', () => {
  const start = now + 3 * 60 * MIN;
  const confirmed = now - 3 * 24 * 60 * MIN;
  // cron runs at arbitrary phase relative to the start
  for (const phase of [0, 1, 2.5, 4.9]) {
    const t = firstPick(start, confirmed, now + phase * MIN);
    assert(t !== null);
    const ahead = (start - t) / MIN;
    assert(ahead > 60 && ahead <= 65, `ahead=${ahead}`);
    assertEquals(soonKind(start, t), '1h');
  }
});

Deno.test('booked 91 min before (like 03aafc54): reminder ~1h before', () => {
  const start = now + 91 * MIN;
  const t = firstPick(start, now, now);
  assert(t !== null);
  assert((start - t) / MIN <= 65 && (start - t) / MIN > 60);
  assertEquals(soonKind(start, t), '1h');
});

Deno.test('booked 60 min before: not right after confirmation; catch-up after 20 min', () => {
  const start = now + 60 * MIN;
  assertEquals(isSoonDue(start, now, now), false);
  const t = firstPick(start, now, now);
  assertEquals(t, now + 20 * MIN);
  assertEquals(soonKind(start, t!), 'catchup');
});

Deno.test('booked 40 min before: catch-up 20 min later (20 min before start)', () => {
  const start = now + 40 * MIN;
  const t = firstPick(start, now, now);
  assertEquals(t, now + 20 * MIN);
  assertEquals(soonKind(start, t!), 'catchup');
});

Deno.test('booked 30 min before: no soon reminder (confirmation is recent)', () => {
  const start = now + 30 * MIN;
  assertEquals(firstPick(start, now, now), null);
});

Deno.test('boundaries: >15 min and <=65 min ahead, confirmation >=20 min ago', () => {
  const old = now - 60 * MIN;
  assertEquals(isSoonDue(now + 65 * MIN, old, now), true);
  assertEquals(isSoonDue(now + 65 * MIN + 1, old, now), false);
  assertEquals(isSoonDue(now + 15 * MIN, old, now), false);
  assertEquals(isSoonDue(now + 15 * MIN + 1, old, now), true);
  assertEquals(isSoonDue(now + 30 * MIN, now - 20 * MIN, now), true);
  assertEquals(isSoonDue(now + 30 * MIN, now - 20 * MIN + 1, now), false);
  assertEquals(soonKind(now + 55 * MIN, now), '1h');
  assertEquals(soonKind(now + 55 * MIN - 1, now), 'catchup');
});

Deno.test('copy: 1h and catch-up name the time; WhatsApp uses REMINDER_1H', () => {
  const ro = messageReminder('Salon Ana', '10:00', 'Europe/Bucharest', 'ro', '1h');
  assertStringIncludes(ro.text, 'într-o oră, la ora 10:00');
  assertStringIncludes(ro.subject, 'într-o oră');
  const roC = messageReminder('Salon Ana', '10:00', 'Europe/Bucharest', 'ro', 'catchup');
  assertStringIncludes(roC.text, 'în curând, azi la ora 10:00');
  assertStringIncludes(roC.subject, 'azi la ora 10:00');
  const en = messageReminder('Salon Ana', '10:00', 'Europe/Bucharest', 'en', '1h');
  assertStringIncludes(en.text, 'in 1 hour, at 10:00');
  const enC = messageReminder('Salon Ana', '10:00', 'Europe/Bucharest', 'en', 'catchup');
  assertStringIncludes(enC.text, 'soon, today at 10:00');
  for (const m of [ro, roC, en, enC]) {
    assert(!m.text.includes('30'), m.text);
    assertEquals(m.wa.key, 'REMINDER_1H');
    assertEquals(m.wa.vars.length, WA_TEMPLATE_VARS.REMINDER_1H.length);
  }
});
