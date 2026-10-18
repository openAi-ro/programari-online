import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Callout, EmptyState, ListLoadingScreen, Screen, useTheme } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { fetchLatestMessages, fetchUnreadCounts, listConversations } from '@/lib/chatRpc';
import { useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { ChatConversation, ChatMessage } from '@/lib/types';
import { formatBadgeCount } from '@/components/CountBadge';

type ClientInfo = { client_user_id: string; display_name: string | null; contact: string };

export default function BusinessChatListScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const [rows, setRows] = useState<ChatConversation[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
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
    const r = await supabase.rpc('list_business_clients');
    if (!r.error) {
      const map: Record<string, string> = {};
      for (const c of ((r.data ?? []) as ClientInfo[])) map[c.client_user_id] = c.display_name ?? c.contact;
      setLabels(map);
    }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { setLoading(true); void load(); }, [load]));
  if (loading && rows.length === 0) {
    return <ListLoadingScreen title={tr('bchat.title')} subtitle={tr('bchat.subtitle')} onBack={back} label={tr('chat.loading')} />;
  }
  return (
    <Screen title={tr('bchat.title')} subtitle={tr('bchat.subtitle')} onBack={back}>
      {error ? (
        <Callout tone='danger' title={tr('common.errorTitle')}>{error}</Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon='chatbubbles-outline' title={tr('chat.empty')} description={tr('bchat.emptyDesc')} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push('/(app)/business/chat/' + item.id as never)} style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: t.colors.text }]} numberOfLines={1}>{labels[item.client_user_id] ?? tr('wl.client')}</Text>
                <Text style={[styles.preview, { color: t.colors.textMuted }]} numberOfLines={1}>{latest[item.id]?.body ?? tr('chat.openConvo')}</Text>
                {(unread[item.id] ?? 0) > 0 ? (<View style={[styles.unreadBadge, { backgroundColor: t.colors.danger }]}><Text style={styles.unreadText} numberOfLines={1} maxFontSizeMultiplier={1.3}>{formatBadgeCount(unread[item.id] ?? 0)}</Text></View>) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  preview: { fontSize: 13 },
  unreadBadge: { alignSelf: 'flex-start', minWidth: 20, minHeight: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginTop: 4 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});

