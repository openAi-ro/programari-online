import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Callout, EmptyState, ListLoadingScreen, Screen, useTheme } from '@/components/ui';
import { trKey, useT } from '@/lib/i18n';
import { spacing } from '@/constants/theme';
import { presentLocalChatNotification } from '@/lib/notifications';
import { formatLocalTime } from '@/lib/timezone';
import { listMessages, markConversationRead, sendMessage } from '@/lib/chatRpc';
import { mergeMessages } from '@/lib/chatPaging';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { useFocusEffect } from 'expo-router';
import type { ChatMessage } from '@/lib/types';

function shortPreview(body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 80).trim()}…` : clean;
}
function Bubble({ message, isMe, timezone }: { message: ChatMessage; isMe: boolean; timezone: string }) {
  const t = useTheme();
  const time = formatLocalTime(new Date(message.created_at), timezone);
  return (
    <View style={[styles.bubbleWrap, { alignSelf: isMe ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.bubble, { backgroundColor: isMe ? t.colors.accent : t.colors.bgElevated }]}>
        <Text style={[styles.bubbleText, { color: isMe ? '#fff' : t.colors.text }]}>{message.body}</Text>
      </View>
      <Text style={[styles.bubbleTime, { color: t.colors.textMuted, textAlign: isMe ? 'right' : 'left' }]}>{time}</Text>
    </View>
  );
}
export default function ChatThread({ conversationId, isClient }: { conversationId: string; isClient: boolean }) {
  const t = useTheme();
  const tr = useT();
  const back = useBack();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counterpartyName, setCounterpartyName] = useState('Chat');
  const [counterpartyTz, setCounterpartyTz] = useState('Europe/Bucharest');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const userIdRef = useRef<string | null>(null);
  const counterpartyNameRef = useRef<string>('Chat');
  const seenIdsRef = useRef<Set<string>>(new Set());
  const loadingOlderRef = useRef(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // The list is inverted (newest message = offset 0 = visual bottom).
  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated });
    });
  }, []);
  const newestFirst = useMemo(() => messages.slice().reverse(), [messages]);
  const load = useCallback(async () => {
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setError(trKey('auth.notSignedIn')); return; }
    userIdRef.current = user.id;
    const { data: conv, error: convErr } = await supabase.from('chat_conversations').select('*').eq('id', conversationId).maybeSingle();
    if (convErr) { setLoading(false); setError(convErr.message); return; }
    if (!conv) { setLoading(false); setError(trKey('chat.noAccess')); return; }
    let name = isClient ? 'Business' : 'Client';
    let tz = 'Europe/Bucharest';
    if (isClient) {
      const { data: biz } = await supabase.from('business_profiles').select('id, name, timezone').eq('id', conv.business_id).maybeSingle();
      if (biz) { name = biz.name ?? 'Business'; tz = biz.timezone ?? tz; }
    } else {
      const { data: clients } = await supabase.rpc('list_business_clients');
      const client = ((clients ?? []) as Array<{ client_user_id: string; display_name: string | null; contact: string }>).find((c) => c.client_user_id === conv.client_user_id);
      name = client?.display_name ?? client?.contact ?? 'Client';
      const { data: biz } = await supabase.from('business_profiles').select('timezone').limit(1).maybeSingle();
      tz = biz?.timezone ?? tz;
    }
    setCounterpartyName(name); counterpartyNameRef.current = name; setCounterpartyTz(tz);
    const { messages: fetched, hasMore, error: msgErr } = await listMessages(conversationId);
    if (msgErr) { setLoading(false); setError(msgErr); return; }
    setMessages(fetched);
    setHasOlder(hasMore);
    void markConversationRead(conversationId);
    seenIdsRef.current = new Set(fetched.map((m) => m.id));
    setLoading(false);
  }, [conversationId, isClient]);
  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!hasOlder || loadingOlderRef.current || !oldest) return;
    loadingOlderRef.current = true; setLoadingOlder(true);
    const { messages: older, hasMore, error: msgErr } = await listMessages(conversationId, { before: oldest });
    if (msgErr) setError(msgErr);
    else {
      for (const m of older) seenIdsRef.current.add(m.id);
      setMessages((prev) => mergeMessages(prev, older));
      setHasOlder(hasMore);
    }
    loadingOlderRef.current = false; setLoadingOlder(false);
  }, [conversationId, hasOlder, messages]);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));
  useEffect(() => {
    if (loading || userIdRef.current === null) return;
    const channel = supabase.channel(`chat-${conversationId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
      const row = payload.new as ChatMessage | undefined;
      if (!row || row.conversation_id !== conversationId || row.sender_user_id === userIdRef.current || seenIdsRef.current.has(row.id)) return;
      seenIdsRef.current.add(row.id); setMessages((prev) => mergeMessages(prev, [row]));
      scrollToBottom(true);
      void presentLocalChatNotification({ title: counterpartyNameRef.current, body: shortPreview(row.body), conversationId, isClient });
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, isClient, loading, scrollToBottom]);
  async function onSend() {
    const body = draft.trim(); if (!body || sending) return;
    setSending(true); setError(null);
    const { message, error: err } = await sendMessage(conversationId, body);
    if (err) setError(err === 'empty_message' ? trKey('chat.msgEmpty') : err === 'message_too_long' ? trKey('chat.msgTooLong') : trKey('chat.sendError', { err }));
    else if (message?.id) { seenIdsRef.current.add(message.id); setMessages((prev) => mergeMessages(prev, [message])); setDraft(''); scrollToBottom(true); }
    setSending(false); Keyboard.dismiss();
  }
  if (loading && messages.length === 0) return <ListLoadingScreen title={counterpartyName} subtitle={isClient ? tr('chat.withBusiness') : tr('chat.withClient')} onBack={back} label={tr('chat.loadingConvo')} />;
  const composer = (
    <View style={[styles.inputRow, { borderTopWidth: 1, borderTopColor: t.colors.border }]}>
      <TextInput
        style={[styles.input, { color: t.colors.text, backgroundColor: t.colors.bgElevated }]}
        placeholder={tr('chat.writeMessage')}
        placeholderTextColor={t.colors.textMuted}
        value={draft}
        onChangeText={setDraft}
        editable={!sending}
        multiline
        numberOfLines={2}
        maxLength={4000}
        autoCorrect={false}
      />
      <Pressable
        style={[
          styles.sendBtn,
          {
            backgroundColor: sending || !draft.trim() ? t.colors.bgElevated : t.colors.accent,
            opacity: sending || !draft.trim() ? 0.6 : 1,
          },
        ]}
        onPress={onSend}
        disabled={sending || !draft.trim()}
        accessibilityLabel={tr('chat.sendMessageA11y')}
      >
        <Ionicons
          name="send-outline"
          size={16}
          color={sending || !draft.trim() ? t.colors.textMuted : '#fff'}
        />
      </Pressable>
    </View>
  );

  return (
    <Screen
      title={isClient ? 'Chat' : tr('chat.clientChatTitle')}
      subtitle={counterpartyName}
      onBack={back}
      scroll={false}
      bottomInset={0}
      keyboardAvoid
      footer={composer}
    >
      <View style={styles.body}>
        {error ? (
          <View style={styles.centerContent}>
            <Callout tone="danger" title={tr('chat.errorTitle')}>
              {error}
            </Callout>
            <View style={styles.centerRow}>
              <Button variant="secondary" label={tr('ui.retryDefault')} onPress={load} />
            </View>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.centerContent}>
            <EmptyState
              icon="chatbubbles-outline"
              title={tr('chat.noMessages')}
              description={tr('chat.firstMessageHint')}
              action={<Button variant="secondary" label={tr('chat.goBack')} onPress={back} />}
            />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={newestFirst}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Bubble
                message={item}
                isMe={item.sender_user_id === userIdRef.current}
                timezone={counterpartyTz}
              />
            )}
            contentContainerStyle={styles.messages}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onEndReached={() => { void loadOlder(); }}
            onEndReachedThreshold={0.3}
            ListFooterComponent={loadingOlder ? <ActivityIndicator style={styles.olderSpinner} color={t.colors.textMuted} /> : null}
          />
        )}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  body: { flex: 1, width: '100%' },
  messages: { paddingHorizontal: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  // Spacing lives inside each cell: a container `gap` is not part of measured cell lengths,
  // which broke scroll-up (wheel) on web for the inverted list.
  bubbleWrap: { alignSelf: 'flex-start', maxWidth: '80%', gap: 2, paddingVertical: spacing.xs },
  bubble: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTime: { fontSize: 10, marginTop: 1 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg },
  centerRow: { marginTop: spacing.lg },
  olderSpinner: { paddingVertical: spacing.sm },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end', width: '100%' },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, maxHeight: 76 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
});
