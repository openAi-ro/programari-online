import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Platform,
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
import * as ImagePicker from 'expo-image-picker';
import { listMessages, markConversationRead, sendAttachment, sendMessage } from '@/lib/chatRpc';
import { ChatAttachmentThumb, ChatMediaViewer } from '@/components/ChatMedia';
import { CHAT_VIDEO_MAX_SECONDS, chatMessagePreview, planChatAttachment, type ChatAttachmentKind } from '@/lib/mediaKeys';
import { readLocalFileBytes, signChatFiles, uploadChatFile } from '@/lib/mediaUpload';
import { pickerDurationToMs } from '@/lib/videoRules';
import { mergeMessages } from '@/lib/chatPaging';
import { useDictation } from '@/lib/useDictation';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import { useFocusEffect } from 'expo-router';
import type { ChatMessage } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

// Unique topic for each subscription: supabase.channel(sameTopic) returns a channel that
// is still subscribed or leaving, and .on() after subscribe() throws.
let chatChannelSeq = 0;

function shortPreview(message: ChatMessage): string {
  const clean = chatMessagePreview(message, { image: trKey('chat.photoLabel'), video: trKey('chat.videoLabel') });
  return clean.length > 80 ? `${clean.slice(0, 80).trim()}…` : clean;
}
function Bubble({
  message,
  isMe,
  timezone,
  attachmentUrl,
  onOpen,
}: {
  message: ChatMessage;
  isMe: boolean;
  timezone: string;
  attachmentUrl: string | null;
  onOpen: (kind: ChatAttachmentKind, url: string) => void;
}) {
  const t = useTheme();
  const time = formatLocalTime(new Date(message.created_at), timezone);
  const kind = message.attachment_key ? message.attachment_kind ?? null : null;
  return (
    <View style={[styles.bubbleWrap, { alignSelf: isMe ? 'flex-end' : 'flex-start' }]}>
      {kind ? (
        <ChatAttachmentThumb
          kind={kind}
          url={attachmentUrl}
          onOpen={() => {
            if (attachmentUrl) onOpen(kind, attachmentUrl);
          }}
        />
      ) : null}
      {message.body ? (
        <View style={[styles.bubble, { backgroundColor: isMe ? t.colors.accent : t.colors.bgElevated }]}>
          <Text style={[styles.bubbleText, { color: isMe ? '#fff' : t.colors.text }]}>{message.body}</Text>
        </View>
      ) : null}
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
  const [error, setError] = useTransientMessage();
  const [counterpartyName, setCounterpartyName] = useState('Chat');
  const [counterpartyTz, setCounterpartyTz] = useState('Europe/Bucharest');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attaching, setAttaching] = useState(false);
  // Signed read URLs for chat files (1 h); refreshed on every focus/load.
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ kind: ChatAttachmentKind; url: string } | null>(null);
  // Microfon (doar web): dictarea completează câmpul, trimiterea rămâne manuală.
  const dictation = useDictation(draft, setDraft);
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
    const user = await getCurrentUser();
    if (!user) { setLoading(false); setError(trKey('auth.notSignedIn'), { sticky: true }); return; }
    userIdRef.current = user.id;
    const { data: conv, error: convErr } = await supabase.from('chat_conversations').select('*').eq('id', conversationId).maybeSingle();
    if (convErr) { setLoading(false); setError(convErr.message, { sticky: true }); return; }
    if (!conv) { setLoading(false); setError(trKey('chat.noAccess'), { sticky: true }); return; }
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
    if (msgErr) { setLoading(false); setError(msgErr, { sticky: true }); return; }
    setSignedUrls({});
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
    const missing = Array.from(
      new Set(messages.map((m) => m.attachment_key).filter((k): k is string => !!k && !signedUrls[k]))
    ).slice(0, 100);
    if (missing.length === 0) return;
    let alive = true;
    void signChatFiles(missing).then((urls) => {
      if (alive && Object.keys(urls).length > 0) setSignedUrls((prev) => ({ ...prev, ...urls }));
    });
    return () => { alive = false; };
  }, [messages, signedUrls]);
  useEffect(() => {
    if (!conversationId) return;
    chatChannelSeq += 1;
    const channel = supabase.channel(`chat-${conversationId}-${chatChannelSeq}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      const row = payload.new as ChatMessage | undefined;
      if (!row || row.sender_user_id === userIdRef.current || seenIdsRef.current.has(row.id)) return;
      seenIdsRef.current.add(row.id); setMessages((prev) => mergeMessages(prev, [row]));
      scrollToBottom(true);
      void presentLocalChatNotification({ title: counterpartyNameRef.current, body: shortPreview(row), conversationId, isClient });
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, isClient, scrollToBottom]);
  async function onSend() {
    const body = draft.trim(); if (!body || sending) return;
    setSending(true); setError(null);
    const { message, error: err } = await sendMessage(conversationId, body);
    if (err) setError(err === 'empty_message' ? trKey('chat.msgEmpty') : err === 'message_too_long' ? trKey('chat.msgTooLong') : trKey('chat.sendError', { err }));
    else if (message?.id) { seenIdsRef.current.add(message.id); setMessages((prev) => mergeMessages(prev, [message])); setDraft(''); scrollToBottom(true); }
    setSending(false); Keyboard.dismiss();
  }
  async function sendPicked(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const durationMs = pickerDurationToMs(asset.duration, Platform.OS);
    const plan = planChatAttachment({ pickerType: asset.type, mimeType: asset.mimeType, sizeBytes: asset.fileSize, durationMs });
    if (!plan.ok) {
      setError(plan.error === 'too_big' ? trKey('chat.attachTooBig') : plan.error === 'too_long' ? trKey('chat.attachTooLong') : trKey('chat.attachBadType'));
      return;
    }
    setAttaching(true); setError(null);
    try {
      const buffer = await readLocalFileBytes(asset.uri, plan.ext);
      const sized = planChatAttachment({ pickerType: asset.type, mimeType: plan.mime, sizeBytes: buffer.byteLength, durationMs });
      if (!sized.ok) throw new Error(trKey('chat.attachTooBig'));
      const uploaded = await uploadChatFile(conversationId, plan.ext, buffer, plan.mime);
      const { message, error: err } = await sendAttachment(
        conversationId,
        { key: uploaded.key, kind: plan.kind, mime: plan.mime, bytes: uploaded.bytes },
        draft
      );
      if (err) setError(err === 'message_too_long' ? trKey('chat.msgTooLong') : trKey('chat.sendError', { err }));
      else if (message?.id) { seenIdsRef.current.add(message.id); setMessages((prev) => mergeMessages(prev, [message])); setDraft(''); scrollToBottom(true); }
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('chat.sendError', { err: '' }));
    }
    setAttaching(false);
  }
  async function pickAttachment(source: 'gallery' | 'photo' | 'video') {
    try {
      if (source === 'gallery') {
        await sendPicked(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.8, videoMaxDuration: CHAT_VIDEO_MAX_SECONDS }));
        return;
      }
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError(trKey('chat.attachPermission')); return; }
      await sendPicked(await ImagePicker.launchCameraAsync({ mediaTypes: source === 'photo' ? ['images'] : ['videos'], quality: 0.8, videoMaxDuration: CHAT_VIDEO_MAX_SECONDS }));
    } catch {
      setError(trKey('chat.attachPermission'));
    }
  }
  function openAttachMenu() {
    if (attaching || sending) return;
    // Web: the browser's file dialog already offers camera on phones; Alert buttons don't render there.
    if (Platform.OS === 'web') { void pickAttachment('gallery'); return; }
    Alert.alert(tr('chat.attachTitle'), tr('chat.attachBody'), [
      { text: tr('chat.attachGallery'), onPress: () => void pickAttachment('gallery') },
      { text: tr('chat.attachCamera'), onPress: () => void pickAttachment('photo') },
      { text: tr('chat.attachRecord'), onPress: () => void pickAttachment('video') },
      { text: tr('common.cancel'), style: 'cancel' },
    ]);
  }
  if (loading && messages.length === 0) return <ListLoadingScreen title={counterpartyName} subtitle={isClient ? tr('chat.withBusiness') : tr('chat.withClient')} onBack={back} label={tr('chat.loadingConvo')} />;
  const composer = (
    <View style={[styles.inputRow, { borderTopWidth: 1, borderTopColor: t.colors.border }]}>
      {dictation.error ? (
        <Text style={[styles.micError, { color: t.colors.danger }]}>
          {dictation.error === 'denied' ? tr('chat.micDenied') : tr('chat.micFailed')}
        </Text>
      ) : !dictation.supported && Platform.OS === 'web' ? (
        <Text style={[styles.micError, { color: t.colors.textMuted }]}>{tr('chat.micUnsupported')}</Text>
      ) : null}
      {attaching ? (
        <Text style={[styles.micError, { color: t.colors.textMuted }]}>{tr('chat.attachSending')}</Text>
      ) : null}
      <Pressable
        style={[styles.sendBtn, { backgroundColor: t.colors.bgElevated, opacity: attaching || sending ? 0.6 : 1 }]}
        onPress={openAttachMenu}
        disabled={attaching || sending}
        accessibilityRole="button"
        accessibilityLabel={tr('chat.attachA11y')}
      >
        {attaching ? <ActivityIndicator color={t.colors.textMuted} /> : <Ionicons name="attach-outline" size={20} color={t.colors.text} />}
      </Pressable>
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
      {dictation.supported ? (
        <Pressable
          style={[styles.sendBtn, { backgroundColor: dictation.listening ? t.colors.danger : t.colors.bgElevated }]}
          onPress={dictation.toggle}
          disabled={sending}
          accessibilityRole="button"
          accessibilityState={{ selected: dictation.listening }}
          accessibilityLabel={dictation.listening ? tr('chat.micStopA11y') : tr('chat.micA11y')}
        >
          <Ionicons name={dictation.listening ? 'stop' : 'mic-outline'} size={18} color={dictation.listening ? '#fff' : t.colors.text} />
        </Pressable>
      ) : null}
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
            <Callout onClose={() => setError(null)} tone="danger" title={tr('chat.errorTitle')}>
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
            extraData={signedUrls}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Bubble
                message={item}
                isMe={item.sender_user_id === userIdRef.current}
                timezone={counterpartyTz}
                attachmentUrl={item.attachment_key ? signedUrls[item.attachment_key] ?? null : null}
                onOpen={(kind, url) => setViewer({ kind, url })}
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
      <ChatMediaViewer media={viewer} onClose={() => setViewer(null)} />
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
  inputRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'flex-end', width: '100%' },
  micError: { width: '100%', fontSize: 12 },
  input: { flex: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, maxHeight: 76 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
});
