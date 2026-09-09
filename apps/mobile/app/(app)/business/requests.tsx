import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
import {
  Callout,
  EmptyState,
  LoadingScreen,
  Screen,
  Segmented,
  useTheme,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useBack } from '@/lib/nav';
import { invokeDecisionNotify } from '@/lib/notify-client';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile } from '@/lib/types';

type Row = Appointment & { business?: BusinessProfile | null };

export default function BusinessRequestsScreen() {
  const t = useTheme();
  const back = useBack();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [timezoneByBusiness, setTimezoneByBusiness] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError('Nu ești autentificat.');
      return;
    }

    const { data: businesses, error: bErr } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('owner_user_id', user.id);

    if (bErr) {
      setError(bErr.message);
      setLoading(false);
      return;
    }

    const list = (businesses ?? []) as BusinessProfile[];
    if (list.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }

    const tzMap: Record<string, string> = {};
    for (const b of list) tzMap[b.id] = b.timezone;
    setTimezoneByBusiness(tzMap);

    const ids = list.map((b) => b.id);
    let query = supabase
      .from('appointments')
      .select('*')
      .in('business_id', ids)
      .order('created_at', { ascending: false });

    if (filter === 'pending') {
      query = query.eq('status', 'pending');
    }

    const { data, error: aErr } = await query;
    if (aErr) {
      setError(aErr.message);
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  async function updateStatus(id: string, status: 'approved' | 'rejected') {
    setError(null);
    const { error: err } = await supabase
      .from('appointments')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending');
    if (err) {
      setError(err.message);
      return;
    }

    const notify = await invokeDecisionNotify(id);
    if (!notify.ok) {
      console.warn('WhatsApp/email notify:', notify.error);
    }

    await load();
  }

  function localLabel(a: Appointment): string {
    const tz = timezoneByBusiness[a.business_id] ?? 'Europe/Bucharest';
    const start = formatInTimeZone(new Date(a.start_at), tz, 'dd.MM.yyyy HH:mm');
    const end = formatInTimeZone(new Date(a.end_at), tz, 'HH:mm');
    return `${start} – ${end}`;
  }

  if (loading && rows.length === 0) {
    return <LoadingScreen label="Se încarcă cererile…" />;
  }

  return (
    <Screen title="Cereri programări" subtitle="Cereri noi și istoric" onBack={back} scroll={false}>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={t.colors.accent}
            colors={[t.colors.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'pending', label: 'În așteptare' },
                { value: 'all', label: 'Toate' },
              ]}
            />
            {error ? (
              <Callout tone="danger" title="A apărut o eroare">
                {error}
              </Callout>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={filter === 'pending' ? 'hourglass-outline' : 'calendar-clear-outline'}
            title={
              filter === 'pending' ? 'Nicio cerere în așteptare' : 'Nu există programări'
            }
            description={
              filter === 'pending'
                ? 'Când un client trimite o cerere, apare aici pentru aprobare.'
                : 'Clienții tăi vor apărea în această listă după prima programare.'
            }
          />
        }
        renderItem={({ item }) => (
          <AppointmentCard
            appointment={item}
            localLabel={localLabel(item)}
            showActions
            onApprove={() => updateStatus(item.id, 'approved')}
            onReject={() => updateStatus(item.id, 'rejected')}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  headerBlock: { gap: spacing.md, marginBottom: spacing.xs },
});
