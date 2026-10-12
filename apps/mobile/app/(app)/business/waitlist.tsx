import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  Button,
  Callout,
  EmptyState,
  ListLoadingScreen,
  Screen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { WaitlistEntry } from '@/lib/types';

type Row = WaitlistEntry & {
  services?: { name: string | null } | null;
  staff?: { name: string | null } | null;
};

export default function BusinessWaitlistScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: biz } = await supabase
      .from('business_profiles')
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle();
    if (!biz) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error: err } = await supabase
      .from('waitlist')
      .select('*, services(name), staff(name)')
      .eq('business_id', biz.id)
      .eq('status', 'active')
      .order('desired_date', { ascending: true });
    if (err) {
      const plain = await supabase
        .from('waitlist')
        .select('*')
        .eq('business_id', biz.id)
        .eq('status', 'active')
        .order('desired_date', { ascending: true });
      if (plain.error) setError(plain.error.message);
      else setRows((plain.data ?? []) as Row[]);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  async function remove(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('leave_waitlist', { p_waitlist_id: id });
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title={tr('wl.title')}
        subtitle={tr('wl.subtitle')}
        onBack={back}
        label={tr('wl.loading')}
      />
    );
  }

  return (
    <Screen title={tr('wl.title')} subtitle={tr('wl.subtitle')} onBack={back}>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {rows.length === 0 ? (
        <EmptyState
          icon="hourglass-outline"
          title={tr('wl.empty')}
          description={tr('wl.emptyDesc')}
        />
      ) : (
        rows.map((row) => {
          const contact = [row.client_phone, row.client_email].filter(Boolean).join(' · ');
          return (
            <View
              key={row.id}
              style={[
                styles.card,
                { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              ]}
            >
              <Text style={[styles.date, { color: t.colors.text }]}>{row.desired_date}</Text>
              <Text style={[styles.meta, { color: t.colors.textMuted }]}>
                {row.staff?.name ? `${row.staff.name} · ` : ''}
                {row.services?.name ? `${row.services.name} · ` : ''}
                {contact || tr('wl.client')}
              </Text>
              <Button
                label={tr('wl.remove')}
                variant="secondary"
                size="sm"
                onPress={() => void remove(row.id)}
              />
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  date: { fontSize: fontSize.lg, fontWeight: '800' },
  meta: { fontSize: fontSize.sm },
});
