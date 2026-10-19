import { supabase } from './supabase';
import type { ChatConversation, ChatMessage } from './types';
import { CHAT_PAGE_SIZE, olderThanFilter, pageFromNewestFirst, type ChatCursor } from './chatPaging';

function rpcErrorText(error: { message?: string; details?: string; hint?: string }): string {
  return [
    error.message,
    error.details,
    error.hint,
  ]
    .filter(Boolean)
    .join(' — ');
}

/**
 * Ensure (or fetch) the chat conversation for the current user and a business.
 * Idempotent: creates the row if it doesn't exist, returns it if it does.
 */
export async function ensureChatConversation(
  businessId: string
): Promise<{ conversation: ChatConversation | null; error: string | null }> {
  const { data, error } = await supabase.rpc('ensure_chat_conversation', {
    p_business_id: businessId,
  });

  if (error) {
    return { conversation: null, error: rpcErrorText(error) };
  }

  if (Array.isArray(data)) {
    return { conversation: (data[0] ?? null) as ChatConversation | null, error: null };
  }

  const conversation = data as ChatConversation | null;
  if (!conversation?.id) {
    return { conversation: null, error: 'conversation_not_created' };
  }
  return { conversation, error: null };
}

/**
 * Send a message to a conversation. Requires the caller to be a participant.
 */
/**
 * Conversation between the caller's business and a specific client.
 * Business-side counterpart of ensureChatConversation: the conversation is
 * (business, client), never (business, owner).
 */
export async function ensureChatConversationForClient(
  businessId: string,
  clientUserId: string
): Promise<{ conversation: ChatConversation | null; error: string | null }> {
  const { data, error } = await supabase.rpc('ensure_chat_conversation_for_client', {
    p_business_id: businessId,
    p_client_user_id: clientUserId,
  });

  if (error) {
    return { conversation: null, error: rpcErrorText(error) };
  }

  if (Array.isArray(data)) {
    return { conversation: (data[0] ?? null) as ChatConversation | null, error: null };
  }

  const conversation = data as ChatConversation | null;
  if (!conversation?.id) {
    return { conversation: null, error: 'conversation_not_created' };
  }
  return { conversation, error: null };
}

/** Unread message count per conversation for the current user (v38). */
export async function fetchUnreadCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc('chat_unread_counts');
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const row of data as { conversation_id: string; unread: number | string }[]) {
    const n = Number(row.unread) || 0;
    if (n > 0) out[row.conversation_id] = n;
  }
  return out;
}

/** Total unread across all of the current user's conversations. */
export async function fetchUnreadTotal(): Promise<number> {
  const counts = await fetchUnreadCounts();
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

/** Mark a conversation as read by the current participant (v38). */
export async function markConversationRead(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const { error } = await supabase.rpc('mark_chat_conversation_read', {
    p_conversation: conversationId,
  });
  if (error) console.warn('mark_chat_conversation_read failed', error.message);
}

export async function sendMessage(
  conversationId: string,
  body: string
): Promise<{ message: ChatMessage | null; error: string | null }> {
  const trimmed = body.trim();
  if (!trimmed) {
    return { message: null, error: 'empty_message' };
  }
  if (trimmed.length > 4000) {
    return { message: null, error: 'message_too_long' };
  }

  const { data, error } = await supabase.rpc('insert_chat_message', {
    p_conversation: conversationId,
    p_body: trimmed,
  });

  if (error) {
    return { message: null, error: rpcErrorText(error) };
  }

  if (Array.isArray(data)) {
    const first = data[0] as ChatMessage | null;
    return { message: first, error: null };
  }

  const message = data as ChatMessage | null;
  if (!message?.id) {
    return { message: null, error: 'message_not_created' };
  }
  return { message, error: null };
}

/**
 * List all chat conversations the current user participates in.
 * RLS select policy (participant) filters to the user's rows.
 */
export async function listConversations(): Promise<{
  conversations: ChatConversation[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .order('last_message_at', { ascending: false });

  if (error) {
    return { conversations: [], error: rpcErrorText(error) };
  }

  return { conversations: (data ?? []) as ChatConversation[], error: null };
}

/**
 * Latest message per conversation, for list previews: one newest-first,
 * limit-1 query per conversation, so it is correct however long a chat is.
 */
export async function fetchLatestMessages(
  conversationIds: string[]
): Promise<{ latest: Record<string, ChatMessage | null>; error: string | null }> {
  const latest: Record<string, ChatMessage | null> = Object.fromEntries(
    conversationIds.map((id) => [id, null])
  );
  let firstError: string | null = null;

  await Promise.all(
    conversationIds.map(async (conversationId) => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id,body,conversation_id,created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1);
      if (error) {
        firstError ??= rpcErrorText(error);
        return;
      }
      latest[conversationId] = ((data ?? [])[0] ?? null) as ChatMessage | null;
    })
  );

  return { latest, error: firstError };
}

/**
 * One page of a conversation: the newest `limit` messages, or the `limit`
 * messages just before `before` (scroll-up pagination). Returned oldest → newest.
 * RLS select policy (participant) filters to rows the user can read.
 */
export async function listMessages(
  conversationId: string,
  opts?: { limit?: number; before?: ChatCursor }
): Promise<{ messages: ChatMessage[]; hasMore: boolean; error: string | null }> {
  const limit = opts?.limit ?? CHAT_PAGE_SIZE;
  let query = supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId);
  if (opts?.before) query = query.or(olderThanFilter(opts.before));
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (error) {
    return { messages: [], hasMore: false, error: rpcErrorText(error) };
  }

  const page = pageFromNewestFirst((data ?? []) as ChatMessage[], limit);
  return { ...page, error: null };
}
