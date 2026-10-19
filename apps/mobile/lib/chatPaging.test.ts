/**
 * Run: npx tsx lib/chatPaging.test.ts
 * from apps/mobile
 */
import { CHAT_PAGE_SIZE, compareMessages, mergeMessages, olderThanFilter, pageFromNewestFirst } from './chatPaging';
import type { ChatMessage } from './types';

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

console.log('chatPaging tests\n');

const BASE = Date.parse('2026-10-19T20:00:00.000Z');
function msg(n: number, sameTimeAs?: number): ChatMessage {
  const t = new Date(BASE + (sameTimeAs ?? n) * 1000).toISOString();
  return { id: `m-${String(n).padStart(4, '0')}`, conversation_id: 'c1', sender_user_id: 'u1', body: `#${n}`, created_at: t };
}
/** Simulates the DB: newest-first order on (created_at, id), optional cursor, limit. */
function dbPage(all: ChatMessage[], limit: number, before?: ChatMessage): ChatMessage[] {
  return all
    .filter((m) => !before || compareMessages(m, before) < 0)
    .sort((a, b) => compareMessages(b, a))
    .slice(0, limit + 1);
}

const all = Array.from({ length: 105 }, (_, i) => msg(i + 1));

{
  const first = pageFromNewestFirst(dbPage(all, CHAT_PAGE_SIZE), CHAT_PAGE_SIZE);
  assert(first.messages.length === CHAT_PAGE_SIZE, 'prima pagina are CHAT_PAGE_SIZE mesaje');
  assert(first.messages[first.messages.length - 1].body === '#105', 'cel mai nou mesaj (#105) e ultimul = jos');
  assert(first.messages[0].body === '#56', 'prima pagina incepe la #56 (cele mai noi 50)');
  assert(first.hasMore, 'hasMore = true cand exista mesaje mai vechi');
}

{
  // Bug 11: >100 messages, the newest must be visible (old code returned #1..#100).
  const first = pageFromNewestFirst(dbPage(all, 100), 100);
  assert(first.messages.some((m) => m.body === '#105'), 'cu 105 mesaje si limita 100, #105 apare');
  assert(!first.messages.some((m) => m.body === '#1'), 'cu limita 100, #1..#5 vin abia la scroll in sus');
}

{
  // Paginate all the way up; no duplicates, nothing missing, chronological.
  let shown = pageFromNewestFirst(dbPage(all, CHAT_PAGE_SIZE), CHAT_PAGE_SIZE);
  let list = shown.messages;
  let hasMore = shown.hasMore;
  let pages = 1;
  while (hasMore) {
    const older = pageFromNewestFirst(dbPage(all, CHAT_PAGE_SIZE, list[0]), CHAT_PAGE_SIZE);
    list = mergeMessages(list, older.messages);
    hasMore = older.hasMore;
    pages += 1;
  }
  assert(pages === 3, '105 mesaje / 50 = 3 pagini');
  assert(list.length === 105, 'dupa paginare: toate cele 105 mesaje');
  assert(new Set(list.map((m) => m.id)).size === 105, 'fara duplicate');
  assert(list.every((m, i) => i === 0 || compareMessages(list[i - 1], m) < 0), 'ordine cronologica');
}

{
  // Same timestamp at the page boundary: id cursor keeps both.
  const tie = [msg(1), msg(2), msg(3, 2), msg(4)];
  const p1 = pageFromNewestFirst(dbPage(tie, 2), 2);
  const p2 = pageFromNewestFirst(dbPage(tie, 2, p1.messages[0]), 2);
  const merged = mergeMessages(p1.messages, p2.messages);
  assert(merged.length === 4 && !p2.hasMore, 'mesaje cu acelasi created_at la granita nu se pierd');
}

{
  const page = pageFromNewestFirst(dbPage(all.slice(0, 3), CHAT_PAGE_SIZE), CHAT_PAGE_SIZE);
  assert(page.messages.length === 3 && !page.hasMore, 'conversatie scurta: hasMore = false');
}

{
  const base = [msg(1), msg(2)];
  const merged = mergeMessages(base, [msg(2), msg(3)]);
  assert(merged.length === 3 && merged[2].body === '#3', 'realtime/trimis: append la final, fara dublura');
  const out = mergeMessages([msg(5)], [msg(4)]);
  assert(out[0].body === '#4', 'mesaj mai vechi primit tarziu e pus la locul lui');
}

{
  const f = olderThanFilter({ created_at: '2026-10-19T20:00:00.123456+00:00', id: 'abc' });
  assert(
    f === 'created_at.lt."2026-10-19T20:00:00.123456+00:00",and(created_at.eq."2026-10-19T20:00:00.123456+00:00",id.lt."abc")',
    'filtru cursor (created_at, id) cu valori in ghilimele'
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
