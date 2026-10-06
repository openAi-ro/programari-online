import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Callout, EmptyState, ListLoadingScreen, Screen, useTheme } from '@/components/ui';
import { spacing } from '@/constants/theme';
import { fetchLatestMessages, listConversations } from '@/lib/chatRpc';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { ChatConversation, ChatMessage } from '@/lib/types';

type ClientInfo = { client_user_id: string; display_name: string | null; contact: string };

export default function BusinessChatListScreen() {
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
  const [rows, setRows] = useState<ChatConversation[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<Record<string, ChatMessage | null>>({});
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
    return <ListLoadingScreen title='Mesaje clienți' subtitle='Chat cu clienții' onBack={back} label='Se încarcă conversațiile…' />;
  }
  return (
    <Screen title='Mesaje clienți' subtitle='Chat cu clienții' onBack={back}>
      {error ? (
        <Callout tone='danger' title='A apărut o eroare'>{error}</Callout>
      ) : rows.length === 0 ? (
        <EmptyState icon='chatbubbles-outline' title='Nicio conversație' description='Conversațiile apar după primele programări.' />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push('/(app)/business/chat/' + item.id as never)} style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
              <View style={styles.flex}>
                <Text style={[styles.name, { color: t.colors.text }]} numberOfLines={1}>{labels[item.client_user_id] ?? 'Client'}</Text>
                <Text style={[styles.preview, { color: t.colors.textMuted }]} numberOfLines={1}>{latest[item.id]?.body ?? 'Deschide conversatia'}</Text>
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
  row: { borderWidth: 1, borderRadius: 12, padding: 12 },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
  preview: { fontSize: 13 },
});

