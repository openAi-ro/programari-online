import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile } from '@/lib/types';

type Row = Appointment & { business?: BusinessProfile | null };

export default function BusinessRequestsScreen() {
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
    await load();
  }

  function localLabel(a: Appointment): string {
    const tz = timezoneByBusiness[a.business_id] ?? 'Europe/Bucharest';
    const start = formatInTimeZone(new Date(a.start_at), tz, 'dd.MM.yyyy HH:mm');
    const end = formatInTimeZone(new Date(a.end_at), tz, 'HH:mm');
    return `${start} – ${end}`;
  }

  return (
    <View style={styles.container}>
      <View style={styles.filters}>
        <Pressable
          style={[styles.chip, filter === 'pending' && styles.chipActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={filter === 'pending' ? styles.chipTextActive : styles.chipText}>
            În așteptare
          </Text>
        </Pressable>
        <Pressable
          style={[styles.chip, filter === 'all' && styles.chipActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={filter === 'all' ? styles.chipTextActive : styles.chipText}>
            Toate
          </Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading && rows.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          ListEmptyComponent={
            <Text style={styles.empty}>Nu există cereri{filter === 'pending' ? ' pending' : ''}.</Text>
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f8fafc' },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
  },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { color: '#334155', fontWeight: '500' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#64748b', marginTop: 32 },
  error: { color: '#b91c1c', marginBottom: 8 },
});
