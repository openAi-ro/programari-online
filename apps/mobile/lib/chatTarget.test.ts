/**
 * Run: npx tsx lib/chatTarget.test.ts
 * from apps/mobile
 */
import { resolveBusinessChatTarget } from './chatTarget';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}`);
  }
}

console.log('chatTarget tests\n');

const OWNER = 'owner-1';

{
  const r = resolveBusinessChatTarget({ client_user_id: 'client-9' }, OWNER);
  assert(r.kind === 'ok' && r.clientUserId === 'client-9', 'client cu cont -> ok cu clientul programarii');
}
{
  const r = resolveBusinessChatTarget({ client_user_id: null }, OWNER);
  assert(r.kind === 'guest', 'invitat fara cont -> guest (fara conversatie)');
}
{
  const r = resolveBusinessChatTarget({ client_user_id: OWNER }, OWNER);
  assert(r.kind === 'self', 'walk-in legat de owner -> self (nu conversatie cu sine)');
}
{
  const r = resolveBusinessChatTarget({ client_user_id: '' }, OWNER);
  assert(r.kind === 'guest', 'client gol -> guest');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
