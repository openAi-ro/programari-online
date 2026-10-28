import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  Button,
  Callout,
  EmptyState,
  Field,
  ListLoadingScreen,
  Screen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { localeTag, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessId } from '@/lib/myBusiness';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { Review } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';
import { managerOnly } from '@/components/ManagerOnly';

function BusinessReviewsScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [rows, setRows] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useTransientMessage();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const businessId = await fetchMyBusinessId(user.id);
    if (!businessId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error: err } = await supabase
      .from('reviews')
      .select('*')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) setError(err.message, { sticky: true });
    else setRows((data ?? []) as Review[]);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  async function sendReply(row: Review) {
    const text = (drafts[row.id] ?? '').trim();
    if (!text) return;
    setBusyId(row.id);
    setError(null);
    const { error: err } = await supabase.rpc('reply_to_review', {
      p_review_id: row.id,
      p_reply: text,
    });
    setBusyId(null);
    if (err) {
      setError(err.message);
      return;
    }
    setDrafts((d) => ({ ...d, [row.id]: '' }));
    await load();
  }

  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title={tr('rev.title')}
        subtitle={tr('rev.subtitle')}
        onBack={back}
        label={tr('rev.loading')}
      />
    );
  }

  const avg = rows.length
    ? rows.reduce((s, r) => s + Number(r.rating || 0), 0) / rows.length
    : null;

  return (
    <Screen title={tr('rev.title')} subtitle={tr('rev.subtitle')} onBack={back}>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {avg != null ? (
        <Text style={[styles.avg, { color: t.colors.text }]}>
          ★ {avg.toFixed(1)} · {rows.length}
        </Text>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState icon="star-outline" title={tr('rev.empty')} description={tr('rev.emptyDesc')} />
      ) : (
        rows.map((row) => (
          <View
            key={row.id}
            style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
          >
            <Text style={[styles.rating, { color: t.colors.text }]}>
              {'★'.repeat(Math.min(5, Math.max(1, Math.round(Number(row.rating) || 0))))}
              <Text style={{ color: t.colors.textMuted }}>
                {'  '}
                {new Date(row.created_at).toLocaleDateString(localeTag())}
              </Text>
            </Text>
            {row.comment ? (
              <Text style={[styles.body, { color: t.colors.text }]}>{row.comment}</Text>
            ) : null}
            {row.owner_reply ? (
              <View style={[styles.replyBox, { backgroundColor: t.colors.surfaceMuted }]}>
                <Text style={[styles.replyLabel, { color: t.colors.textMuted }]}>
                  {tr('rev.yourReply')}
                </Text>
                <Text style={[styles.body, { color: t.colors.text }]}>{row.owner_reply}</Text>
              </View>
            ) : (
              <>
                <Field
                  label={tr('rev.yourReply')}
                  value={drafts[row.id] ?? ''}
                  onChangeText={(v) => setDrafts((d) => ({ ...d, [row.id]: v }))}
                  placeholder={tr('rev.replyPh')}
                  multiline
                  maxLength={1000}
                />
                <Button
                  label={tr('rev.replyBtn')}
                  size="sm"
                  variant="secondary"
                  loading={busyId === row.id}
                  disabled={busyId === row.id || !(drafts[row.id] ?? '').trim()}
                  onPress={() => void sendReply(row)}
                />
              </>
            )}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  avg: { fontSize: fontSize.lg, fontWeight: '800' },
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1 },
  rating: { fontSize: fontSize.md, fontWeight: '700' },
  body: { fontSize: fontSize.sm },
  replyBox: { gap: 2, padding: spacing.md, borderRadius: radius.md },
  replyLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase' },
});

export default managerOnly(BusinessReviewsScreen);
