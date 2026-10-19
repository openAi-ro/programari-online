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
import { trKey, useT } from '@/lib/i18n';
import { markNavReady, measureBeforeEnabled } from '@/lib/navTiming';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useBack } from '@/lib/nav';
import { mapBookingRpcError } from '@/lib/bookingRules';
import { listBusyRanges, moveAppointmentToSlot } from '@/lib/bookingRpc';
import { generateFreeSlots } from '@/lib/slots';
import { validateMoveInput } from '@/lib/moveRules';
import { invokeDecisionNotify, invokeMoved, invokePostpone, invokeWaitlistNotify } from '@/lib/notify-client';
import { presentLocalBookingNotification } from '@/lib/notifications';
import { invokeRefundDeposit, invokeWaiveDeposit } from '@/lib/payments';
import { ensureChatConversationForClient, sendMessage } from '@/lib/chatRpc';
import { resolveBusinessChatTarget } from '@/lib/chatTarget';
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
  const tr = useT();
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
  const statusBusyRef = useRef<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const businessIdsRef = useRef<string[]>([]);
  businessIdsRef.current = businessIds;

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError(trKey('req.notAuthed'));
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
          const contact = row.client_email || row.client_phone || trKey('req.newClient');
          void presentLocalBookingNotification({
            title: trKey('req.notifTitle'),
            body: trKey('req.notifBody').replace('{contact}', contact),
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
    if (statusBusyRef.current) return;
    statusBusyRef.current = id;
    try {
    setError(null);
    setSuccess(null);
    const { data: updatedRows, error: err } = await supabase
      .from('appointments')
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id');
    if (err) {
      setError(err.message);
      return;
    }
    if (!updatedRows || updatedRows.length === 0) {
      setError(trKey('req.alreadyDecided'));
      await load();
      return;
    }
    // Cardul se actualizeaza imediat; notificarea si reincarcarea vin dupa.
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));

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
    } finally {
      statusBusyRef.current = null;
    }
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
        setError(result.error ?? trKey('req.postponeFailed'));
        return;
      }
      const hoursLabel = `${hours} ${hours === 1 ? trKey('req.hourOne') : trKey('req.hours')}`;
      setSuccess(trKey('req.postponedBy').replace('{label}', hoursLabel));
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
      setError(trKey('req.bizNotLoaded'));
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
      setSuccess(trKey('req.movedTo').replace('{label}', label));
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
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) { setError(trKey('req.notAuthed')); return; }
    // Conversația e (business, clientul programării) — nu (business, owner).
    const target = resolveBusinessChatTarget(appointment, user.id);
    if (target.kind !== 'ok') { setError(trKey('chat.noAccountForMsg')); return; }
    const { conversation, error: cErr } = await ensureChatConversationForClient(
      appointment.business_id,
      target.clientUserId
    );
    if (cErr || !conversation) { setError(cErr ?? trKey('req.chatOpenFailed')); return; }
    const { error: mErr } = await sendMessage(conversation.id, text);
    if (mErr) setError(mErr); else setSuccess(trKey('req.msgSent'));
  }

  async function waiveDeposit(id: string) {
    setError(null);
    const { ok, error: wErr } = await invokeWaiveDeposit(id);
    if (!ok) { setError(wErr ?? trKey('common.errorTitle')); return; }
    setSuccess(trKey('pay.waivedOk'));
    await load();
  }

  async function deleteAppointment(id: string) {
    setError(null);
    setSuccess(null);
    const row = rows.find((r) => r.id === id);
    const { error: err } = await supabase.rpc('delete_appointment_and_chats', { p_appointment_id: id });
    if (err) {
      setError(err.message);
      return;
    }
    if (row?.payment_status === 'paid') {
      await invokeRefundDeposit(id);
    }
    notifyWaitlistForRow(row);
    setRows((prev) => prev.filter((r) => r.id !== id));
    setSuccess(trKey('req.deleted'));
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
          title={tr('req.title')}
          subtitle={tr('req.subtitle')}
          onBack={back}
          label={tr('req.loading')}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen title={tr('req.title')} subtitle={tr('req.subtitle')} onBack={back} scroll={false}>
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
                { value: 'pending', label: tr('req.pending') },
                { value: 'all', label: tr('req.all') },
              ]}
            />
            {pendingRows.length > 0 ? (
              <Callout tone="warm" title={tr('req.awaitingTitle')}>
                {pendingRows.length === 1
                  ? tr('req.awaitingOne')
                  : tr('req.awaitingMany').replace('{count}', String(pendingRows.length))}
              </Callout>
            ) : null}
            {error ? (
              <Callout tone="danger" title={tr('common.errorTitle')}>
                {error}
              </Callout>
            ) : null}
            {success ? (
              <Callout tone="success" title={tr('common.done')}>
                {success}
              </Callout>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon={filter === 'pending' ? 'hourglass-outline' : 'calendar-clear-outline'}
            title={
              filter === 'pending' ? tr('req.emptyPending') : tr('req.emptyAll')
            }
            description={
              filter === 'pending'
                ? tr('req.emptyPendingDesc')
                : tr('req.emptyAllDesc')
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
            onDelete={() => { setError(null); setSuccess(null); setDeleteTarget(item); }}
            onQuickMessage={(txt) => sendQuickMessage(item, txt)}
            onWaiveDeposit={() => void waiveDeposit(item.id)}
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
                {tr('req.moveTitle')}
              </Text>
              <Pressable
                onPress={() => !moveSaving && setMoveApt(null)}
                accessibilityRole="button"
                accessibilityLabel={tr('common.close')}
                hitSlop={8}
              >
                <Text style={{ color: t.colors.textMuted, fontSize: fontSize.lg }}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {moveError ? <Callout tone="danger">{moveError}</Callout> : null}
              <DatePickerField
                label={tr('req.newDay')}
                value={moveDate}
                onChange={(ymd) => {
                  setMoveDate(ymd);
                  if (moveApt) {
                    const biz = bizForMove(moveApt);
                    if (biz) void reloadMoveSlots(ymd, moveApt, biz);
                  }
                }}
              />
              <SectionTitle>{tr('req.freeSlot')}</SectionTitle>
              {moveLoading ? (
                <Text style={{ color: t.colors.textMuted }}>{tr('req.calcSlots')}</Text>
              ) : moveSlots.length === 0 ? (
                <Text style={{ color: t.colors.textMuted }}>
                  {tr('req.noSlotsDay').replace('{date}', moveDate)}
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
                  label={tr('common.close')}
                  variant="secondary"
                  size="sm"
                  disabled={moveSaving}
                  onPress={() => setMoveApt(null)}
                />
              </View>
              <View style={styles.actionFlex}>
                <Button
                  label={tr('req.move')}
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
      <Modal
        visible={deleteTarget != null}
        animationType="fade"
        transparent
        onRequestClose={() => setDeleteTarget(null)}
        statusBarTranslucent
      >
        <View style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
            <Text style={[styles.modalTitle, { color: t.colors.text }]} numberOfLines={2}>
              {tr('req.confirmDeleteTitle')}
            </Text>
            <Text style={{ color: t.colors.textMuted }}>{tr('req.confirmDeleteBody')}</Text>
            <ButtonRow>
              <View style={styles.actionFlex}>
                <Button
                  label={tr('appt.giveUp')}
                  variant="secondary"
                  size="sm"
                  onPress={() => setDeleteTarget(null)}
                />
              </View>
              <View style={styles.actionFlex}>
                <Button
                  label={tr('appt.deleteSession')}
                  icon="trash-outline"
                  variant="danger"
                  size="sm"
                  onPress={() => {
                    const target = deleteTarget;
                    setDeleteTarget(null);
                    if (target) void deleteAppointment(target.id);
                  }}
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
