import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
import {
  Callout,
  EmptyState,
  ListLoadingScreen,
  Screen,
  Segmented,
  useTheme,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import { useBack } from '@/lib/nav';
import { invokeDecisionNotify, invokePostpone, invokeWaitlistNotify } from '@/lib/notify-client';
import { presentLocalBookingNotification } from '@/lib/notifications';
import { invokeRefundDeposit } from '@/lib/payments';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile } from '@/lib/types';

type Row = Appointment & { business?: BusinessProfile | null };

export default function BusinessRequestsScreen() {
  const t = useTheme();
  const back = useBack();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('all');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [postponeBusyId, setPostponeBusyId] = useState<string | null>(null);
  const [timezoneByBusiness, setTimezoneByBusiness] = useState<Record<string, string>>({});
  const [codeByBusiness, setCodeByBusiness] = useState<Record<string, string>>({});
  const [businessIds, setBusinessIds] = useState<string[]>([]);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  // Id-uri deja văzute — ca popup-ul din bara de notificări să apară
  // doar pentru cereri NOI, nu la fiecare refresh / focus.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const businessIdsRef = useRef<string[]>([]);
  businessIdsRef.current = businessIds;

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
      setBusinessIds([]);
      setLoading(false);
      return;
    }

    const tzMap: Record<string, string> = {};
    const codeMap: Record<string, string> = {};
    for (const b of list) {
      tzMap[b.id] = b.timezone;
      codeMap[b.id] = b.public_code;
    }
    setTimezoneByBusiness(tzMap);
    setCodeByBusiness(codeMap);

    const ids = list.map((b) => b.id);
    setBusinessIds(ids);
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
      const list = (data ?? []) as Row[];
      setRows(list);
      // Marchează tot ce există deja ca „văzut" — popup doar pentru ce vine nou.
      for (const r of list) seenIdsRef.current.add(r.id);
    }
    setLoading(false);
  }, [filter]);

  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  // Realtime: refresh when appointments change for owned businesses
  // + popup local în bara de notificări la fiecare cerere NOUĂ (fallback
  // pentru push-ul remote — apare chiar dacă FCM / webhook-ul pică).
  useEffect(() => {
    if (businessIds.length === 0) return;

    const channel = supabase
      .channel(`biz-requests-${businessIds.join(',')}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
        },
        (payload) => {
          const eventType = (payload as { eventType?: string }).eventType ?? '';
          const row = (payload.new ?? payload.old) as
            | ({
                id?: string;
                business_id?: string;
                status?: string;
                client_email?: string | null;
                client_phone?: string | null;
                start_at?: string;
              })
            | null;
          if (!row?.business_id || !businessIdsRef.current.includes(row.business_id)) {
            return;
          }
          const isInsert = eventType === 'INSERT' || payload.old == null;
          if (
            isInsert &&
            (row.status ?? 'pending') === 'pending' &&
            row.id &&
            !seenIdsRef.current.has(row.id)
          ) {
            seenIdsRef.current.add(row.id);
            const contact = row.client_email || row.client_phone || 'Client nou';
            void presentLocalBookingNotification({
              title: 'Cerere nouă de programare',
              body: `Ai o cerere de la ${contact}. Deschide Cereri pentru a răspunde.`,
              appointmentId: row.id,
              businessId: row.business_id,
            });
          }
          void loadRef.current();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [businessIds]);

  async function updateStatus(id: string, status: 'approved' | 'rejected') {
    setError(null);
    setSuccess(null);
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

    if (status === 'rejected') {
      notifyWaitlistForRow(rows.find((r) => r.id === id));
      const row = rows.find((r) => r.id === id);
      if (row?.payment_status === 'paid') {
        void invokeRefundDeposit(id);
      }
    }

    await load();
  }

  function notifyWaitlistForRow(row: Row | undefined) {
    if (!row) return;
    const tz = timezoneByBusiness[row.business_id] ?? 'Europe/Bucharest';
    const desiredDate = formatInTimeZone(new Date(row.start_at), tz, 'yyyy-MM-dd');
    const code = codeByBusiness[row.business_id];
    void invokeWaitlistNotify({
      business_id: row.business_id,
      desired_date: desiredDate,
      booking_url: code ? getWebBookingUrl(code) : '',
    });
  }

  async function postponeAppointment(id: string, hours: 1 | 2) {
    setError(null);
    setSuccess(null);
    setPostponeBusyId(id);
    try {
      const result = await invokePostpone(id, hours);
      if (!result.ok) {
        setError(result.error ?? 'Amânarea a eșuat.');
        return;
      }
      const hoursLabel = hours === 1 ? '1 oră' : '2 ore';
      setSuccess(`Programarea a fost amânată cu ${hoursLabel}. Clientul a fost notificat.`);
      notifyWaitlistForRow(rows.find((r) => r.id === id));
      await load();
    } finally {
      setPostponeBusyId(null);
    }
  }

  async function markPaid(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('mark_deposit_paid', { p_appointment_id: id });
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function waiveDeposit(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('waive_deposit', { p_appointment_id: id });
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function markNoShow(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('mark_no_show', { p_appointment_id: id });
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  async function clearNoShow(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('clear_no_show', { p_appointment_id: id });
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

  const pendingRows = filter === 'pending' ? rows : rows.filter((r) => r.status === 'pending');

  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title="Cereri programări"
        subtitle="Cereri noi și istoric"
        onBack={back}
        label="Se încarcă cererile…"
      />
    );
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
            {pendingRows.length > 0 ? (
              <Callout tone="warning" title="Cereri care așteaptă răspuns">
                {pendingRows.length === 1
                  ? 'Ai 1 cerere în așteptare. Aprobă, respinge sau amână.'
                  : `Ai ${pendingRows.length} cereri în așteptare. Aprobă, respinge sau amână.`}
              </Callout>
            ) : null}
            {error ? (
              <Callout tone="danger" title="A apărut o eroare">
                {error}
              </Callout>
            ) : null}
            {success ? (
              <Callout tone="success" title="Amânare reușită">
                {success}
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
                ? 'Nicio cerere pending. Deschide „Toate” ca să vezi programările confirmate.'
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
            onPostpone={(hours) => postponeAppointment(item.id, hours)}
            postponeBusy={postponeBusyId === item.id}
            onMarkPaid={() => void markPaid(item.id)}
            onWaiveDeposit={() => void waiveDeposit(item.id)}
            onMarkNoShow={() => void markNoShow(item.id)}
            onClearNoShow={() => void clearNoShow(item.id)}
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
