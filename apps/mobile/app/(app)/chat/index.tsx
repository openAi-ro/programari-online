import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Callout, EmptyState, ListLoadingScreen, Screen, useTheme } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { fetchLatestMessages, fetchUnreadCounts, listConversations } from '@/lib/chatRpc';
import { chatMessagePreview } from '@/lib/mediaKeys';
import { useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { ChatConversation, ChatMessage } from '@/lib/types';
import { formatBadgeCount } from '@/components/CountBadge';
import { ClientTabBar } from '@/components/ClientTabBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ClientChatListScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<ChatConversation[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<Record<string, ChatMessage | null>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    const res = await listConversations();
    if (res.error) { setLoading(false); setError(res.error); return; }
    setRows(res.conversations);
    const ids = res.conversations.map((c) => c.id);
    const lat = await fetchLatestMessages(ids);
    setLatest(lat.latest);
    setUnread(await fetchUnreadCounts());
    const bizIds: string[] = [];
    for (const c of res.conversations) { if (bizIds.indexOf(c.business_id) < 0) bizIds.push(c.business_id); }
    if (bizIds.length) {
      const r = await supabase.from('business_profiles').select('id, name').in('id', bizIds);
      const map: Record<string, string> = {};
      for (const b of ((r.data ?? []) as Array<{ id: string; name: string }>)) map[b.id] = b.name;
      setNames(map);
    }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));
  if (loading && rows.length === 0) {
    return (
      <View style={styles.root}>
        <ListLoadingScreen title={tr('chat.title')} subtitle={tr('chat.subtitle')} onBack={back} label={tr('chat.loading')} />
        <ClientTabBar />
      </View>
    );
  }
  return (
    <View style={styles.root}>
    <Screen title={tr('chat.title')} subtitle={tr('chat.subtitle')} onBack={back} bottomInset={insets.bottom + spacing['3xl'] + 56}>
      {error ? (
        <Callout tone='danger' title={tr('common.errorTitle')}>{error}</Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon='chatbubbles-outline' title={tr('chat.empty')} description={tr('chat.emptyDesc')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push('/(app)/chat/' + item.id as never)} style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: t.colors.text }]} numberOfLines={1}>{names[item.business_id] ?? tr('chat.business')}</Text>
                <Text style={[styles.preview, { color: t.colors.textMuted }]} numberOfLines={1}>{latest[item.id] ? chatMessagePreview(latest[item.id]!, { image: tr('chat.photoLabel'), video: tr('chat.videoLabel') }) : tr('chat.openConvo')}</Text>
                {(unread[item.id] ?? 0) > 0 ? (<View style={[styles.unreadBadge, { backgroundColor: t.colors.danger }]}><Text style={[styles.unreadText, { color: t.colors.onAccent }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>{formatBadgeCount(unread[item.id] ?? 0)}</Text></View>) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
    <ClientTabBar />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  list: { gap: spacing.sm },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  preview: { fontSize: 13 },
  unreadBadge: { alignSelf: 'flex-start', minWidth: 20, minHeight: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginTop: 4 },
  unreadText: { fontSize: 12, fontWeight: '800' },
});

