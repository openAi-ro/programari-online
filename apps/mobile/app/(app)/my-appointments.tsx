import { useCallback, useMemo, useState } from 'react';
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
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile } from '@/lib/types';

type Row = Appointment & {
  business_profiles?: Pick<BusinessProfile, 'name' | 'timezone'> | null;
};

type Filter = 'all' | 'upcoming' | 'past';

export default function MyAppointmentsScreen() {
  const t = useTheme();
  const back = useBack();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

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

    const { data, error: err } = await supabase
      .from('appointments')
      .select('*, business_profiles(name, timezone)')
      .eq('client_user_id', user.id)
      .order('start_at', { ascending: false });

    if (err) {
      // fallback without join if relationship name differs
      const plain = await supabase
        .from('appointments')
        .select('*')
        .eq('client_user_id', user.id)
        .order('start_at', { ascending: false });
      if (plain.error) {
        setError(plain.error.message);
      } else {
        setRows((plain.data ?? []) as Row[]);
      }
    } else {
      setRows((data ?? []) as Row[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  function localLabel(a: Row): string {
    const tz = a.business_profiles?.timezone ?? 'Europe/Bucharest';
    const start = formatInTimeZone(new Date(a.start_at), tz, 'dd.MM.yyyy HH:mm');
    const end = formatInTimeZone(new Date(a.end_at), tz, 'HH:mm');
    return `${start} – ${end}`;
  }

  async function cancelAppointment(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('cancel_appointment', {
      p_appointment_id: id,
    });
    if (err) {
      setError(
        err.message.includes('cannot_cancel')
          ? 'Această programare nu mai poate fi anulată.'
          : err.message
      );
      return;
    }
    await load();
  }

  const shown = useMemo(() => {
    const now = Date.now();
    if (filter === 'upcoming') {
      return rows.filter((r) => new Date(r.end_at).getTime() >= now);
    }
    if (filter === 'past') {
      return rows.filter((r) => new Date(r.end_at).getTime() < now);
    }
    return rows;
  }, [rows, filter]);

  if (loading && rows.length === 0) {
    return <LoadingScreen label="Se încarcă programările…" />;
  }

  return (
    <Screen title="Programările mele" subtitle="Ce ai rezervat și ce urmează" onBack={back} scroll={false}>
      <FlatList
        data={shown}
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
                { value: 'all', label: 'Toate' },
                { value: 'upcoming', label: 'Viitoare' },
                { value: 'past', label: 'Trecute' },
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
            title={
              rows.length === 0
                ? 'Nu ai programări încă'
                : filter === 'upcoming'
                  ? 'Nicio programare viitoare'
                  : 'Nicio programare trecută'
            }
            description={
              rows.length === 0
                ? 'Scanează codul QR al unui business sau deschide un link de programare.'
                : 'Schimbă filtrul ca să vezi celelalte programări.'
            }
          />
        }
        renderItem={({ item }) => (
          <AppointmentCard
            appointment={item}
            businessName={item.business_profiles?.name}
            localLabel={localLabel(item)}
            onCancel={() => cancelAppointment(item.id)}
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
