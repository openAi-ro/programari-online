import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
import { localeTag, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { invokeWaitlistNotify } from '@/lib/notify-client';
import { filterWaitlistByDate, waitlistDates } from '@/lib/waitlistFilter';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { WaitlistEntry } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

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
  const [error, setError] = useTransientMessage();
  const [success, setSuccess] = useTransientMessage();
  const [bizCode, setBizCode] = useState('');
  const [notifyBusyId, setNotifyBusyId] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: biz } = await fetchMyBusinessResult(user.id);
    if (biz) setBizCode(biz.public_code ?? '');
    if (!biz) {
      setRows([]);
      setLoading(false);
      return;
    }
    const { data, error: err } = await supabase
      .from('waitlist')
      .select('*, services(name), staff(name)')
      .eq('business_id', biz.id)
      .in('status', ['active', 'notified'])
      .order('desired_date', { ascending: true });
    if (err) {
      const plain = await supabase
        .from('waitlist')
        .select('*')
        .eq('business_id', biz.id)
        .in('status', ['active', 'notified'])
        .order('desired_date', { ascending: true });
      if (plain.error) setError(plain.error.message, { sticky: true });
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

  async function notifyRow(row: Row) {
    setError(null);
    setSuccess(null);
    setNotifyBusyId(row.id);
    const res = await invokeWaitlistNotify({
      business_id: row.business_id,
      desired_date: row.desired_date,
      booking_url: bizCode ? getWebBookingUrl(bizCode) : '',
      waitlist_id: row.id,
    });
    setNotifyBusyId(null);
    if (!res.ok) {
      setError(tr('wl.notifyFailed'));
      return;
    }
    const payload = res.data as
      | { outcomes?: { id: string; ok: boolean }[] }
      | undefined;
    const mine = payload?.outcomes?.find((o) => o.id === row.id);
    if (mine && !mine.ok) {
      setError(tr('wl.notifyFailed'));
      return;
    }
    setSuccess(tr('wl.notifiedOk'));
    await load();
  }
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
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {success ? <Callout onClose={() => setSuccess(null)} tone="success">{success}</Callout> : null}
      {rows.length > 0 ? (
        <View style={styles.chips}>
          {[null, ...waitlistDates(rows)].map((d) => {
            const activeChip = filterDate === d;
            return (
              <Pressable
                key={d ?? 'all'}
                onPress={() => setFilterDate(d)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: activeChip ? t.colors.accentSoft : t.colors.surface,
                    borderColor: activeChip ? t.colors.accent : t.colors.border,
                  },
                ]}
              >
                <Text style={{ color: activeChip ? t.colors.accent : t.colors.text }}>
                  {d ?? tr('wl.allDays')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {rows.length > 0 && filterWaitlistByDate(rows, filterDate).length === 0 ? (
        <Text style={[styles.meta, { color: t.colors.textMuted }]}>{tr('wl.noForDay')}</Text>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon="hourglass-outline"
          title={tr('wl.empty')}
          description={tr('wl.emptyDesc')}
        />
      ) : (
        filterWaitlistByDate(rows, filterDate).map((row) => {
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
              {row.status === 'notified' ? (
                <Text style={[styles.meta, { color: t.colors.accent }]}>
                  {row.notified_at
                    ? tr('wl.notifiedAt', { when: new Date(row.notified_at).toLocaleString(localeTag()) })
                    : tr('wl.statusNotified')}
                </Text>
              ) : null}
              <Button
                label={row.status === 'notified' ? tr('wl.statusNotified') : tr('wl.notify')}
                variant="secondary"
                size="sm"
                loading={notifyBusyId === row.id}
                disabled={row.status === 'notified'}
                onPress={() => void notifyRow(row)}
              />
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  date: { fontSize: fontSize.lg, fontWeight: '800' },
  meta: { fontSize: fontSize.sm },
});
