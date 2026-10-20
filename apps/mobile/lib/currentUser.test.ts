/**
 * Run: npx tsx lib/currentUser.test.ts
 * from apps/mobile
 */
import type { Session } from '@supabase/supabase-js';

import { fireAndForget } from './fireAndForget';
import { userFromSession } from './sessionUser';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  const session = { user: { id: 'u1', email: 'a@b.ro' } } as unknown as Session;
  let calls = 0;
  const u = await userFromSession({
    getSession: async () => {
      calls += 1;
      return { data: { session } };
    },
  });
  assert(u?.id === 'u1', 'întoarce userul din sesiune', `got ${u?.id}`);
  assert(calls === 1, 'o singură citire de sesiune');

  const none = await userFromSession({ getSession: async () => ({ data: { session: null } }) });
  assert(none === null, 'fără sesiune → null');

  const broken = await userFromSession({
    getSession: async () => {
      throw new Error('storage');
    },
  });
  assert(broken === null, 'eroare de storage → null, nu aruncă');

  const logs: unknown[][] = [];
  const warn = (...a: unknown[]) => logs.push(a);
  fireAndForget(Promise.resolve({ ok: true }), 'ok', warn);
  fireAndForget(Promise.resolve({ ok: false, error: 'wa_down' }), 'notify failed', warn);
  fireAndForget(Promise.reject(new Error('network')), 'notify threw', warn);
  await tick();
  await tick();
  assert(logs.length === 2, 'loghează doar eșecurile', JSON.stringify(logs));
  assert(logs.some((l) => l[0] === 'notify failed' && l[1] === 'wa_down'), 'eroare din rezultat');
  assert(logs.some((l) => l[0] === 'notify threw' && l[1] === 'network'), 'excepție prinsă, nu unhandled');

  console.log(`currentUser: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
