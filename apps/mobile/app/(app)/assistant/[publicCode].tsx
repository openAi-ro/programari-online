import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import {
  Button,
  Callout,
  ListLoadingScreen,
  Screen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { formatDuration, formatRon } from '@/lib/format';
import {
  answerAssistantMessage,
  buildAssistantKnowledge,
  type AssistantAction,
  type AssistantAnswer,
  type AssistantKnowledge,
} from '@/lib/assistant';
import { ensureChatConversationForClient } from '@/lib/chatRpc';
import { locationFromBusiness, formatAddress } from '@/lib/location';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';

type Message = { from: 'user' | 'bot'; text: string; actions: AssistantAction[] };

function answerText(tr: ReturnType<typeof useT>, answer: AssistantAnswer): string {
  const p = answer.params;
  switch (answer.intent) {
    case 'greeting':
      return tr('as.greeting', { business: p.business ?? '' });
    case 'service_price':
      return tr('as.price', { name: p.name ?? '', price: p.price ?? '', duration: p.duration ?? '' });
    case 'services_list':
      return tr('as.list', { business: p.business ?? '', list: p.list ?? '' });
    case 'hours':
      return tr('as.hours', { business: p.business ?? '' });
    case 'location':
      return tr('as.location', { address: p.address ?? '' });
    case 'staff':
      return tr('as.staff', { business: p.business ?? '', names: p.names ?? '' });
    case 'book':
      return tr('as.book', {});
    case 'cancel_policy':
      return tr('as.cancel', { notice: p.notice ?? '' });
    case 'deposit':
      return tr('as.deposit', { business: p.business ?? '', deposit: p.deposit ?? '' });
    case 'human':
      return tr('as.human', { business: p.business ?? '' });
    case 'fallback':
    default:
      return tr('as.fallback', { business: p.business ?? '' });
  }
}

export default function AssistantScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const { publicCode } = useLocalSearchParams<{ publicCode?: string | string[] }>();
  const code = String(Array.isArray(publicCode) ? publicCode[0] : publicCode ?? '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [knowledge, setKnowledge] = useState<AssistantKnowledge | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('public_code', code)
      .maybeSingle();
    if (err || !data) {
      setError(err?.message ?? trKey('book.notFound'));
      setLoading(false);
      return;
    }
    const name = data.name as string;
    setBusinessId(data.id as string);
    setBusinessName(name);
    const [svcRes, staffRes] = await Promise.all([
      supabase
        .from('services')
        .select('name, duration_minutes, price')
        .eq('business_id', data.id)
        .eq('active', true)
        .order('sort_order'),
      supabase
        .from('staff')
        .select('name')
        .eq('business_id', data.id)
        .eq('active', true)
        .order('sort_order'),
    ]);
    const services = (svcRes.data ?? []).map((s) => ({
      name: s.name as string,
      duration: formatDuration(s.duration_minutes as number),
      price: formatRon(s.price as number),
    }));
    const k = buildAssistantKnowledge({
      businessName: name,
      address: formatAddress(locationFromBusiness(data)) ?? '',
      phone: (data.phone as string | null) ?? '',
      cancelNoticeText:
        typeof data.cancel_notice_minutes === 'number'
          ? `${data.cancel_notice_minutes} min`
          : '',
      depositText:
        typeof data.deposit_ron === 'number' && data.deposit_ron > 0
          ? formatRon(data.deposit_ron)
          : '0',
      services,
      staffNames: (staffRes.data ?? []).map((s) => s.name as string),
    });
    setKnowledge(k);
    setMessages([{ from: 'bot', text: tr('as.greeting', { business: name }), actions: [] }]);
    setLoading(false);
  }, [code, tr]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  function send(text: string) {
    if (!knowledge) return;
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    const answer = answerAssistantMessage(knowledge, clean);
    setMessages((m) => [
      ...m,
      { from: 'user', text: clean, actions: [] },
      { from: 'bot', text: answerText(tr, answer), actions: answer.actions },
    ]);
    setDraft('');
    setSending(false);
  }

  async function openChat() {
    if (!businessId) return;
    setChatBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setChatBusy(false);
      router.push('/(auth)/login' as never);
      return;
    }
    const { conversation, error: err } = await ensureChatConversationForClient(businessId, user.id);
    setChatBusy(false);
    if (err || !conversation) {
      setError(err ?? trKey('chat.errorTitle'));
      return;
    }
    router.push(`/(app)/chat/${conversation.id}` as never);
  }

  function handleAction(action: AssistantAction) {
    if (action.type === 'book') {
      router.push(`/(app)/book/${code}` as never);
      return;
    }
    if (action.type === 'chat') {
      void openChat();
    }
  }

  if (loading && !knowledge) {
    return (
      <ListLoadingScreen
        title={tr('as.title')}
        subtitle={businessName || tr('as.subtitle')}
        onBack={back}
        label={tr('book.loadingAgenda')}
      />
    );
  }

  const suggestions = [tr('as.suggestPrice'), tr('as.suggestHours'), tr('as.suggestBook')];

  return (
    <Screen title={tr('as.title')} subtitle={businessName || tr('as.subtitle')} onBack={back}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {messages.map((m, i) => (
          <View
            key={i}
            style={[
              styles.bubble,
              m.from === 'user' ? styles.user : styles.bot,
              {
                backgroundColor: m.from === 'user' ? t.colors.accentSoft : t.colors.surface,
                borderColor: t.colors.border,
              },
            ]}
          >
            <Text style={[styles.text, { color: t.colors.text }]}>{m.text}</Text>
            {m.from === 'bot' && m.actions.length > 0 ? (
              <View style={styles.actions}>
                {m.actions.map((a, j) => (
                  <Button
                    key={j}
                    size="sm"
                    variant="secondary"
                    label={a.type === 'book' ? tr('as.bookBtn') : a.type === 'chat' ? tr('as.chatBtn') : tr('book.pickServiceTitle')}
                    onPress={() => handleAction(a)}
                    loading={a.type === 'chat' && chatBusy}
                  />
                ))}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      {messages.length <= 1 ? (
        <View style={styles.chips}>
          {suggestions.map((s) => (
            <Button key={s} size="sm" variant="secondary" label={s} onPress={() => send(s)} />
          ))}
        </View>
      ) : null}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: t.colors.text, borderColor: t.colors.border, backgroundColor: t.colors.surface }]}
            value={draft}
            onChangeText={setDraft}
            placeholder={tr('as.placeholder')}
            placeholderTextColor={t.colors.textFaint}
            onSubmitEditing={() => send(draft)}
            returnKeyType="send"
          />
          <Button label={tr('as.send')} onPress={() => send(draft)} disabled={!draft.trim()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { gap: spacing.sm, paddingVertical: spacing.sm },
  bubble: { padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm },
  user: { alignSelf: 'flex-end', maxWidth: '85%' },
  bot: { alignSelf: 'flex-start', maxWidth: '95%' },
  text: { fontSize: fontSize.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  inputRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
  },
});
