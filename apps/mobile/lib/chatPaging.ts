import type { ChatMessage } from './types';

/** How many messages a chat thread loads at once (newest first, then older pages). */
export const CHAT_PAGE_SIZE = 50;

/** Position of a message in the conversation: (created_at, id) is unique and totally ordered. */
export type ChatCursor = Pick<ChatMessage, 'created_at' | 'id'>;

/** Chronological comparison (oldest first); id breaks ties between equal timestamps. */
export function compareMessages(a: ChatCursor, b: ChatCursor): number {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge message lists without duplicates (same id), result oldest → newest.
 * Used for older pages, realtime inserts and our own sent messages.
 */
export function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values()).sort(compareMessages);
}

/**
 * PostgREST `or` filter for "strictly older than the cursor" on (created_at, id).
 * Values are double-quoted because timestamps contain ':' and '+'.
 */
export function olderThanFilter(cursor: ChatCursor): string {
  const ts = `"${cursor.created_at}"`;
  const id = `"${cursor.id}"`;
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`;
}

/**
 * A page is fetched newest-first with limit + 1 rows: the extra row only tells
 * us that older messages exist. Returns the page oldest → newest for display.
 */
export function pageFromNewestFirst(
  rowsNewestFirst: ChatMessage[],
  limit: number
): { messages: ChatMessage[]; hasMore: boolean } {
  const hasMore = rowsNewestFirst.length > limit;
  const page = rowsNewestFirst.slice(0, limit);
  return { messages: page.slice().sort(compareMessages), hasMore };
}
