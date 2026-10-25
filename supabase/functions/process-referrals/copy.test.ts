import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { referralRewardPush } from './copy.ts';

Deno.test('push recompensă: română implicit', () => {
  const p = referralRewardPush('ro', 'Salon Ana', '10% reducere');
  assertEquals(p.title, 'Ai primit o recompensă!');
  assertStringIncludes(p.body, 'Recompensa ta: 10% reducere.');
});

Deno.test('push recompensă: engleză pentru profil EN', () => {
  const p = referralRewardPush('en', 'Salon Ana', '');
  assertEquals(p.title, 'You earned a reward!');
  assertStringIncludes(p.body, 'Ask the salon for your reward!');
});
