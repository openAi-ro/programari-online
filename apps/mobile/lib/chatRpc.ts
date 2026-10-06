import { supabase } from './supabase';
import type { ChatConversation, ChatMessage } from './types';

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
 * Latest message per conversation, for list previews.
 * Fetches a bounded set of messages (newest last) and keeps the last row
 * seen for each conversation_id, which is the most recent message.
 */
export async function fetchLatestMessages(
  conversationIds: string[]
): Promise<{ latest: Record<string, ChatMessage | null>; error: string | null }> {
  if (!conversationIds.length) {
    return { latest: Object.fromEntries(conversationIds.map((id) => [id, null])), error: null };
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id,body,conversation_id,created_at')
    .order('conversation_id')
    .order('created_at')
    .limit(500);

  if (error) {
    return { latest: Object.fromEntries(conversationIds.map((id) => [id, null])), error: rpcErrorText(error) };
  }

  const latest: Record<string, ChatMessage | null> = Object.fromEntries(
    conversationIds.map((id) => [id, null])
  );

  for (const row of (data ?? []) as ChatMessage[]) {
    if (!latest[row.conversation_id]) {
      continue;
    }
    latest[row.conversation_id] = {
      id: row.id,
      body: row.body,
      conversation_id: row.conversation_id,
      created_at: row.created_at,
    } as ChatMessage;
  }

  return { latest, error: null };
}

/**
 * List messages for a conversation, oldest first.
 * RLS select policy (participant) filters to rows the user can read.
 */
export async function listMessages(
  conversationId: string,
  opts?: { limit: number }
): Promise<{ messages: ChatMessage[]; error: string | null }> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .filter('conversation_id', 'eq', conversationId)
    .order('created_at', { ascending: true })
    .limit(opts?.limit ?? 100);

  if (error) {
    return { messages: [], error: rpcErrorText(error) };
  }

  return { messages: (data ?? []) as ChatMessage[], error: null };
}
