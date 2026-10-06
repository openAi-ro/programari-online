import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
import { DatePickerField } from '@/components/DatePickerField';
import {
  Button,
  ButtonRow,
  Callout,
  EmptyState,
  ListLoadingScreen,
  Screen,
  SectionTitle,
  Segmented,
  useTheme,
} from '@/components/ui';
import { markNavReady, measureBeforeEnabled } from '@/lib/navTiming';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useBack } from '@/lib/nav';
import { mapBookingRpcError } from '@/lib/bookingRules';
import { listBusyRanges, moveAppointmentToSlot } from '@/lib/bookingRpc';
import { generateFreeSlots } from '@/lib/slots';
import { validateMoveInput } from '@/lib/moveRules';
import { invokeDecisionNotify, invokeMoved, invokePostpone, invokeWaitlistNotify } from '@/lib/notify-client';
import { presentLocalBookingNotification } from '@/lib/notifications';
import { invokeRefundDeposit } from '@/lib/payments';
import { ensureChatConversation, sendMessage } from '@/lib/chatRpc';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { formatInTimeZone, localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile, FreeSlot } from '@/lib/types';

type Row = Appointment & { business?: BusinessProfile | null };

export default function BusinessRequestsScreen() {
  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.count('[TAB_MOUNT] business/requests');
    }
  }, []);
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
  const [businessList, setBusinessList] = useState<BusinessProfile[]>([]);
  const [moveApt, setMoveApt] = useState<Row | null>(null);
  const [moveDate, setMoveDate] = useState('');
  const [moveSlots, setMoveSlots] = useState<FreeSlot[]>([]);
  const [moveSlot, setMoveSlot] = useState<FreeSlot | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveSaving, setMoveSaving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
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
      setBusinessList([]);
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
    setBusinessList(list);
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
      const hasExistingData = rows.length > 0;
      // Soft refresh (MEASURE_BEFORE forces cold skeleton)
      if (measureBeforeEnabled() || !hasExistingData) setLoading(true);
      void load().then(() => {
        markNavReady('requests', {
          hasExistingData,
          softRefresh: hasExistingData && !measureBeforeEnabled(),
        });
      });
    }, [load, rows.length])
  );

  // Realtime: refresh when appointments change for owned businesses
  // + local notification popup on each NEW request (fallback if remote push fails).
  // Unique channel per mount — reusing a subscribed channel after tab remount throws.
  useEffect(() => {
    if (businessIds.length === 0) return;

    const base = `biz-requests-${businessIds.join(',')}`;
    for (const ch of supabase.getChannels()) {
      if (ch.topic === `realtime:${base}` || ch.topic.startsWith(`realtime:${base}-`)) {
        void supabase.removeChannel(ch);
      }
    }

    const channel = supabase.channel(`${base}-${Date.now()}`);
    channel.on(
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
    );
    channel.subscribe();

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

  async function postponeAppointment(id: string, hours: number) {
    setError(null);
    setSuccess(null);
    setPostponeBusyId(id);
    try {
      const result = await invokePostpone(id, hours);
      if (!result.ok) {
        setError(result.error ?? 'Amânarea a eșuat.');
        return;
      }
      const hoursLabel = `${hours} ${hours === 1 ? 'oră' : 'ore'}`;
      setSuccess(`Programarea a fost amânată cu ${hoursLabel}. Clientul a fost notificat.`);
      notifyWaitlistForRow(rows.find((r) => r.id === id));
      await load();
    } finally {
      setPostponeBusyId(null);
    }
  }


  function bizForMove(apt: Row): BusinessProfile | null {
    return businessList.find((b) => b.id === apt.business_id) ?? null;
  }

  function moveDuration(apt: Row, biz: BusinessProfile): number {
    return apt.service_duration_minutes ?? biz.session_duration_minutes;
  }

  async function reloadMoveSlots(dateYmd: string, apt: Row, biz: BusinessProfile) {
    setMoveLoading(true);
    setMoveSlot(null);
    setMoveError(null);
    const { startUtc, endUtc } = localDayBoundsUtc(dateYmd, biz.timezone);
    const { busy: rawBusy, error: busyErr } = await listBusyRanges({
      businessId: biz.id,
      fromIso: startUtc.toISOString(),
      toIso: endUtc.toISOString(),
      staffId: apt.staff_id ?? null,
    });
    if (busyErr) {
      setMoveError(busyErr);
      setMoveSlots([]);
      setMoveLoading(false);
      return;
    }
    const busy = rawBusy.filter(
      (b) => !(b.startUtc === apt.start_at && b.endUtc === apt.end_at)
    );
    const free = generateFreeSlots({
      dateLocal: dateYmd,
      timezone: biz.timezone,
      sessionDurationMinutes: moveDuration(apt, biz),
      workingHours: biz.working_hours,
      breakHours: biz.break_hours,
      busy,
      bufferMinutes: biz.buffer_minutes ?? 0,
      blockedDates: biz.blocked_dates ?? [],
      notBeforeUtc: new Date(),
    });
    setMoveSlots(free);
    setMoveLoading(false);
  }

  function openMove(apt: Row) {
    const biz = bizForMove(apt);
    if (!biz) {
      setError('Business-ul acestei programări nu a fost încărcat.');
      return;
    }
    setError(null);
    setSuccess(null);
    setMoveError(null);
    setMoveApt(apt);
    const ymd = formatInTimeZone(new Date(apt.start_at), biz.timezone, 'yyyy-MM-dd');
    setMoveDate(ymd);
    void reloadMoveSlots(ymd, apt, biz);
  }

  async function saveMove() {
    if (!moveApt) return;
    const invalid = validateMoveInput({
      slotStartUtc: moveSlot?.startUtc ?? null,
      slotEndUtc: moveSlot?.endUtc ?? null,
      currentStartUtc: moveApt.start_at,
    });
    if (invalid) {
      setMoveError(mapBookingRpcError(invalid));
      return;
    }
    setMoveSaving(true);
    setMoveError(null);
    const { error: err } = await moveAppointmentToSlot({
      appointmentId: moveApt.id,
      startAt: (moveSlot as FreeSlot).startUtc,
      endAt: (moveSlot as FreeSlot).endUtc,
    });
    setMoveSaving(false);
    if (err) {
      setMoveError(mapBookingRpcError(err));
      return;
    }
    const notify = await invokeMoved(moveApt.id);
    const label = formatInTimeZone(
      new Date((moveSlot as FreeSlot).startUtc),
      timezoneByBusiness[moveApt.business_id] ?? 'Europe/Bucharest',
      'dd.MM.yyyy HH:mm'
    );
    setMoveApt(null);
    setMoveSlot(null);
    if (!notify.ok) {
      setError(mapBookingRpcError('move_notify_failed'));
    } else {
      setSuccess(`Programarea a fost mutată pe ${label}. Clientul a fost notificat.`);
    }
    notifyWaitlistForRow(rows.find((r) => r.id === moveApt.id));
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

  async function sendQuickMessage(appointment: Appointment, text: string) {
    const { conversation, error: cErr } = await ensureChatConversation(appointment.business_id);
    if (cErr || !conversation) { setError(cErr ?? 'Nu s-a putut deschide chatul.'); return; }
    const { error: mErr } = await sendMessage(conversation.id, text);
    if (mErr) setError(mErr); else setSuccess('Mesaj trimis.');
  }

  async function deleteAppointment(id: string) {
    setError(null);
    setSuccess(null);
    const { error: err } = await supabase.rpc('delete_appointment_and_chats', { p_appointment_id: id });
    if (err) {
      setError(err.message);
      return;
    }
    setSuccess('Programarea și chaturile legate au fost șterse.');
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
      <View style={{ flex: 1 }}>
        <ListLoadingScreen
          title="Cereri programări"
          subtitle="Cereri noi și istoric"
          onBack={back}
          label="Se încarcă cererile…"
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
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
              <Callout tone="warm" title="Cereri care așteaptă răspuns">
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
              <Callout tone="success" title="Gata">
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
            onMoveToSlot={() => openMove(item)}
            postponeBusy={postponeBusyId === item.id}
            onMarkNoShow={() => void markNoShow(item.id)}
            onClearNoShow={() => void clearNoShow(item.id)}
            onDelete={() => void deleteAppointment(item.id)}
            onQuickMessage={(txt) => sendQuickMessage(item, txt)}
          />
        )}
      />
      <Modal
        visible={moveApt != null}
        animationType="slide"
        transparent
        onRequestClose={() => !moveSaving && setMoveApt(null)}
        statusBarTranslucent
      >
        <View style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: t.colors.text }]} numberOfLines={2}>
                Mută pe alt slot
              </Text>
              <Pressable
                onPress={() => !moveSaving && setMoveApt(null)}
                accessibilityRole="button"
                accessibilityLabel="Închide"
                hitSlop={8}
              >
                <Text style={{ color: t.colors.textMuted, fontSize: fontSize.lg }}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {moveError ? <Callout tone="danger">{moveError}</Callout> : null}
              <DatePickerField
                label="Ziua nouă"
                value={moveDate}
                onChange={(ymd) => {
                  setMoveDate(ymd);
                  if (moveApt) {
                    const biz = bizForMove(moveApt);
                    if (biz) void reloadMoveSlots(ymd, moveApt, biz);
                  }
                }}
              />
              <SectionTitle>Slot liber</SectionTitle>
              {moveLoading ? (
                <Text style={{ color: t.colors.textMuted }}>Se calculează sloturile…</Text>
              ) : moveSlots.length === 0 ? (
                <Text style={{ color: t.colors.textMuted }}>
                  Nu mai sunt sloturi libere în {moveDate}. Alege altă zi.
                </Text>
              ) : (
                <View style={styles.slotGrid}>
                  {moveSlots.map((slot) => {
                    const on = moveSlot?.startUtc === slot.startUtc;
                    return (
                      <Pressable
                        key={slot.startUtc}
                        onPress={() => setMoveSlot(slot)}
                        style={[
                          styles.slot,
                          {
                            backgroundColor: on ? t.colors.accent : t.colors.surface,
                            borderColor: on ? t.colors.accent : t.colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: on ? t.colors.onAccent : t.colors.text,
                            fontWeight: '700',
                            fontSize: fontSize.sm,
                          }}
                        >
                          {slot.labelLocal}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </ScrollView>
            <ButtonRow>
              <View style={styles.actionFlex}>
                <Button
                  label="Închide"
                  variant="secondary"
                  size="sm"
                  disabled={moveSaving}
                  onPress={() => setMoveApt(null)}
                />
              </View>
              <View style={styles.actionFlex}>
                <Button
                  label="Mută"
                  icon="checkmark"
                  variant="primary"
                  size="sm"
                  loading={moveSaving}
                  disabled={!moveSlot || moveSaving}
                  onPress={() => void saveMove()}
                />
              </View>
            </ButtonRow>
          </View>
        </View>
      </Modal>
    </Screen>
    </View>
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
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', padding: spacing.md },
  modalCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  modalTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: '800' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  actionFlex: { flex: 1 },
});
