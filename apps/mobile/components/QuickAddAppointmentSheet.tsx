/**
 * v101 (3.03): programare rapidă din business. Deschisă din Calendar (FAB) și din Clienți
 * („Programează"). Client după telefon (autocomplete pe server), mai multe servicii,
 * specialist care le face pe toate, zi + slot liber pe durata totală (inclusiv ore trecute),
 * notă și „Anunță clientul" (implicit OPRIT).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ButtonRow, Callout, Field, SectionTitle, Toggle, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { trKey, useT } from '@/lib/i18n';
import { staffSchedule } from '@/lib/bookingRules';
import { listBusyRanges } from '@/lib/bookingRpc';
import {
  createBusinessAppointment,
  mapQuickAddError,
  searchBusinessClientContacts,
} from '@/lib/businessBooking';
import { fetchBusinessRole } from '@/lib/businessMembers';
import { invokeDecisionNotify } from '@/lib/notify-client';
import { formatPhoneDisplay } from '@/lib/phone';
import {
  buildQuickAddPayload,
  canNotifyClient,
  quickAddDays,
  quickAddQueryReady,
  type BusinessClientContact,
} from '@/lib/quickAddRules';
import { comboTotals, toggleServiceId } from '@/lib/serviceCombo';
import { generateFreeSlots } from '@/lib/slots';
import { staffForServices, staffServicesMap, type StaffServiceRow } from '@/lib/staffServices';
import { supabase } from '@/lib/supabase';
import { formatInTimeZone, localDayBoundsUtc } from '@/lib/timezone';
import type { Appointment, BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';

export type QuickAddStaff = Pick<Staff, 'id' | 'name' | 'working_hours' | 'break_hours'>;

const PAST_DAYS = 14;

type Props = {
  visible: boolean;
  business: BusinessProfile;
  /** activi, în ordinea din echipă; dacă lipsește se citesc la deschidere */
  staffList?: QuickAddStaff[];
  initialDate?: string;
  initialStaffId?: string | null;
  initialClient?: BusinessClientContact | null;
  onClose: () => void;
  onSaved?: (appointment: Appointment | null) => void;
};

export function QuickAddAppointmentSheet({
  visible,
  business,
  staffList: staffProp,
  initialDate,
  initialStaffId,
  initialClient,
  onClose,
  onSaved,
}: Props) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const tz = business.timezone;
  const today = useMemo(() => formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'), [tz, visible]);

  const [staffList, setStaffList] = useState<QuickAddStaff[]>(staffProp ?? []);
  const [services, setServices] = useState<Service[]>([]);
  const [offered, setOffered] = useState<Record<string, string[]>>({});
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  const [isStaffRole, setIsStaffRole] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [day, setDay] = useState(initialDate ?? today);
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<FreeSlot | null>(null);
  const [picked, setPicked] = useState<BusinessClientContact | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(false);
  const [suggestions, setSuggestions] = useState<BusinessClientContact[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Reset + încărcare la fiecare deschidere.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setError(null);
    setOk(null);
    setSlot(null);
    setServiceIds([]);
    setPicked(initialClient ?? null);
    setPhone('');
    setName('');
    setEmail('');
    setNote('');
    setNotify(false);
    setSuggestions([]);
    setDay(initialDate ?? formatInTimeZone(new Date(), tz, 'yyyy-MM-dd'));
    void (async () => {
      const teamReq = staffProp
        ? Promise.resolve({ data: staffProp })
        : supabase
            .from('staff')
            .select('id, name, working_hours, break_hours')
            .eq('business_id', business.id)
            .eq('active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true });
      const [{ data: svcRows }, { data: team }, role, { data: ownStaff }] = await Promise.all([
        supabase
          .from('services')
          .select('*')
          .eq('business_id', business.id)
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        teamReq,
        fetchBusinessRole(business.id),
        supabase.rpc('business_member_staff_id', { p_business_id: business.id }),
      ]);
      if (!alive) return;
      const members = (team ?? []) as QuickAddStaff[];
      const { data: offeredRows } = members.length
        ? await supabase.from('staff_services').select('staff_id, service_id').in('staff_id', members.map((m) => m.id))
        : { data: [] as StaffServiceRow[] };
      if (!alive) return;
      const staffRole = role === 'staff';
      const own = staffRole ? ((ownStaff as string | null) ?? null) : null;
      setIsStaffRole(staffRole);
      setMyStaffId(own);
      setStaffList(staffRole ? members.filter((m) => m.id === own) : members);
      setServices((svcRows ?? []) as Service[]);
      setOffered(staffServicesMap(offeredRows as StaffServiceRow[] | null));
      setStaffId(own ?? initialStaffId ?? null);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, business.id]);

  const totals = useMemo(() => comboTotals(services, serviceIds), [services, serviceIds]);
  const eligible = useMemo(
    () => staffForServices(staffList, offered, serviceIds),
    [staffList, offered, serviceIds]
  );
  const member = useMemo(() => {
    if (staffList.length === 0) return null;
    return eligible.find((m) => m.id === staffId) ?? eligible[0] ?? null;
  }, [eligible, staffId, staffList.length]);

  const days = useMemo(() => {
    const ahead = Math.min(business.max_advance_days ?? 90, 60);
    return quickAddDays(today, PAST_DAYS, ahead);
  }, [today, business.max_advance_days]);

  // Sloturi libere pe durata totală; fără notBefore → și orele trecute (business notează după).
  useEffect(() => {
    if (!visible) return;
    setSlot(null);
    if (totals.durationMinutes <= 0 || (staffList.length > 0 && !member)) {
      setSlots([]);
      return;
    }
    let alive = true;
    setSlotsLoading(true);
    void (async () => {
      const { startUtc, endUtc } = localDayBoundsUtc(day, tz);
      const { busy, error: busyErr } = await listBusyRanges({
        businessId: business.id,
        fromIso: startUtc.toISOString(),
        toIso: endUtc.toISOString(),
        staffId: member?.id ?? null,
      });
      if (!alive) return;
      if (busyErr) setError(busyErr);
      const hours = staffSchedule(member, business);
      setSlots(
        busyErr
          ? []
          : generateFreeSlots({
              dateLocal: day,
              timezone: tz,
              sessionDurationMinutes: totals.durationMinutes,
              workingHours: hours.workingHours,
              breakHours: hours.breakHours,
              busy,
              bufferMinutes: business.buffer_minutes ?? 0,
              blockedDates: business.blocked_dates ?? [],
            })
      );
      setSlotsLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [visible, day, member, totals.durationMinutes, business, tz, staffList.length]);

  // Autocomplete client (telefon / nume) pe server, cu debounce.
  useEffect(() => {
    if (!visible || picked) return;
    const q = phone.trim() || name.trim();
    if (!quickAddQueryReady(q)) {
      setSuggestions([]);
      return;
    }
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void searchBusinessClientContacts(business.id, q).then(({ clients }) => {
        if (seq === searchSeq.current) setSuggestions(clients);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [visible, phone, name, picked, business.id]);

  const notifyAllowed = canNotifyClient(slot?.endUtc ?? null);
  useEffect(() => {
    if (!notifyAllowed && notify) setNotify(false);
  }, [notifyAllowed, notify]);

  async function save() {
    setError(null);
    setOk(null);
    const { payload, error: invalid } = buildQuickAddPayload({
      serviceIds,
      slotStartUtc: slot?.startUtc ?? null,
      picked,
      name,
      phone,
      email,
    });
    if (!payload) {
      setError(mapQuickAddError(invalid ?? ''));
      return;
    }
    setSaving(true);
    const { appointment, error: err } = await createBusinessAppointment({
      businessId: business.id,
      staffId: member?.id ?? null,
      payload,
      note,
      notifyClient: notify && notifyAllowed,
    });
    if (err) {
      setSaving(false);
      setError(mapQuickAddError(err));
      return;
    }
    // Toggle PORNIT: confirmarea către client (email/WhatsApp) pleacă prin notify-decision.
    if (appointment?.id && notify && notifyAllowed) {
      await invokeDecisionNotify(appointment.id);
    }
    setSaving(false);
    const label = formatInTimeZone(new Date(payload.p_start_at), tz, 'dd.MM HH:mm');
    setOk(trKey('cal.addedAt', { label }));
    setSlot(null);
    setPicked(null);
    setPhone('');
    setName('');
    setEmail('');
    setNote('');
    setNotify(false);
    onSaved?.(appointment);
  }

  const chip = (on: boolean) => [
    styles.chip,
    { backgroundColor: on ? t.colors.accent : t.colors.surface, borderColor: on ? t.colors.accent : t.colors.border },
  ];
  const chipText = (on: boolean) => ({
    color: on ? t.colors.onAccent : t.colors.text,
    fontWeight: '700' as const,
    fontSize: fontSize.sm,
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !saving && onClose()} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: t.colors.overlay, paddingBottom: spacing.md + insets.bottom }]}>
        <View style={[styles.card, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: t.colors.text }]} numberOfLines={1}>
              {tr('qa.title')}
            </Text>
            <Pressable onPress={() => !saving && onClose()} accessibilityRole="button" accessibilityLabel={tr('common.close')} hitSlop={8}>
              <Ionicons name="close" size={22} color={t.colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={{ gap: spacing.sm }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {error ? <Callout tone="danger" onClose={() => setError(null)}>{error}</Callout> : null}
            {ok ? <Callout tone="success" onClose={() => setOk(null)}>{ok}</Callout> : null}

            <SectionTitle>{tr('qa.client')}</SectionTitle>
            {picked ? (
              <View style={[styles.pickedRow, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}>
                <Ionicons name="person-circle-outline" size={22} color={t.colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: t.colors.text, fontWeight: '700' }} numberOfLines={1}>
                    {picked.displayName || formatPhoneDisplay(picked.phone) || picked.email}
                  </Text>
                  <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }} numberOfLines={1}>
                    {[picked.phone ? formatPhoneDisplay(picked.phone) : null, picked.email, tr('qa.visits', { n: picked.visitCount })]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Pressable onPress={() => setPicked(null)} accessibilityRole="button" hitSlop={8}>
                  <Text style={{ color: t.colors.accent, fontWeight: '700' }}>{tr('qa.change')}</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Field
                  label={tr('qa.phone')}
                  placeholder="07xx xxx xxx"
                  keyboardType="phone-pad"
                  value={phone}
                  onChangeText={setPhone}
                  testID="qa-phone"
                />
                <Field label={tr('qa.name')} placeholder={tr('qa.namePh')} value={name} onChangeText={setName} testID="qa-name" />
                {suggestions.length > 0 ? (
                  <View style={{ gap: 6 }}>
                    <Text style={[styles.hint, { color: t.colors.textMuted }]}>{tr('qa.existing')}</Text>
                    {suggestions.map((c) => (
                      <Pressable
                        key={c.businessClientId ?? c.clientUserId ?? c.phone ?? c.email ?? ''}
                        onPress={() => {
                          setPicked(c);
                          setSuggestions([]);
                        }}
                        accessibilityRole="button"
                        style={[styles.suggestion, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}
                      >
                        <Ionicons name={c.clientUserId ? 'person' : 'call-outline'} size={16} color={t.colors.textMuted} />
                        <Text style={{ color: t.colors.text, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                          {[c.displayName, c.phone ? formatPhoneDisplay(c.phone) : c.email].filter(Boolean).join(' · ')}
                        </Text>
                        <Text style={{ color: t.colors.textFaint, fontSize: fontSize.xs }}>{tr('qa.visits', { n: c.visitCount })}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Field
                  label={tr('qa.email')}
                  placeholder="client@exemplu.ro"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  value={email}
                  onChangeText={setEmail}
                />
              </>
            )}

            <SectionTitle>
              {serviceIds.length > 0
                ? tr('qa.servicesTotal', { mins: totals.durationMinutes, price: totals.price })
                : tr('qa.services')}
            </SectionTitle>
            <View style={styles.wrap}>
              {services.map((s) => {
                const on = serviceIds.includes(s.id);
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setServiceIds((ids) => toggleServiceId(ids, s.id))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={chip(on)}
                  >
                    <Text style={chipText(on)}>
                      {s.name} · {s.duration_minutes} min
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {staffList.length > 0 ? (
              <>
                <SectionTitle>{tr('team.specialist')}</SectionTitle>
                {serviceIds.length > 0 && eligible.length === 0 ? (
                  <Callout tone="warning">{tr('book.errStaffService')}</Callout>
                ) : (
                  <View style={styles.wrap}>
                    {eligible.map((m) => {
                      const on = member?.id === m.id;
                      return (
                        <Pressable key={m.id} onPress={() => !isStaffRole && setStaffId(m.id)} style={chip(on)} accessibilityRole="button">
                          <Text style={chipText(on)}>{m.name}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
                {isStaffRole && !myStaffId ? <Callout tone="warning">{tr('qa.errStaffOwn')}</Callout> : null}
              </>
            ) : null}

            <SectionTitle>{tr('qa.day')}</SectionTitle>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
              {days.map((d) => {
                const on = d === day;
                const date = new Date(`${d}T12:00:00Z`);
                return (
                  <Pressable key={d} onPress={() => setDay(d)} style={[chip(on), styles.dayChip]} accessibilityRole="button" accessibilityLabel={d}>
                    <Text style={[chipText(on), { fontSize: fontSize.xs }]}>
                      {d === today ? tr('qa.today') : formatInTimeZone(date, 'UTC', 'EEE')}
                    </Text>
                    <Text style={chipText(on)}>{formatInTimeZone(date, 'UTC', 'dd.MM')}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <SectionTitle>{tr('req.freeSlot')}</SectionTitle>
            {serviceIds.length === 0 ? (
              <Text style={[styles.hint, { color: t.colors.textMuted }]}>{tr('qa.pickServiceFirst')}</Text>
            ) : slotsLoading ? (
              <Text style={[styles.hint, { color: t.colors.textMuted }]}>{tr('req.calcSlots')}</Text>
            ) : slots.length === 0 ? (
              <Text style={[styles.hint, { color: t.colors.textMuted }]}>{tr('cal.noSlots', { date: day })}</Text>
            ) : (
              <View style={styles.wrap}>
                {slots.map((s) => {
                  const on = slot?.startUtc === s.startUtc;
                  const past = Date.parse(s.startUtc) < Date.now();
                  return (
                    <Pressable
                      key={s.startUtc}
                      onPress={() => setSlot(s)}
                      style={[
                        styles.slot,
                        {
                          backgroundColor: on ? t.colors.accent : t.colors.surface,
                          borderColor: on ? t.colors.accent : t.colors.border,
                          opacity: past && !on ? 0.6 : 1,
                        },
                      ]}
                    >
                      <Text style={chipText(on)}>{s.labelLocal}</Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <Field label={tr('qa.note')} placeholder={tr('qa.notePh')} value={note} onChangeText={setNote} multiline maxLength={500} />

            <View style={styles.notifyRow}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.colors.text, fontWeight: '700' }}>{tr('qa.notify')}</Text>
                <Text style={[styles.hint, { color: t.colors.textMuted }]}>
                  {notifyAllowed || !slot ? tr('qa.notifyHint') : tr('qa.notifyPast')}
                </Text>
              </View>
              <Toggle value={notify} onValueChange={setNotify} disabled={!notifyAllowed} accessibilityLabel={tr('qa.notify')} />
            </View>
          </ScrollView>
          <ButtonRow>
            <View style={styles.flex}>
              <Button label={tr('common.close')} variant="secondary" size="sm" disabled={saving} onPress={onClose} />
            </View>
            <View style={styles.flex}>
              <Button
                label={tr('qa.save')}
                icon="checkmark"
                size="sm"
                loading={saving}
                disabled={saving || !slot || serviceIds.length === 0}
                onPress={() => void save()}
              />
            </View>
          </ButtonRow>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md, maxHeight: '100%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.lg, fontWeight: '800' },
  scroll: { maxHeight: 560 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1 },
  dayChip: { alignItems: 'center', minWidth: 58, borderRadius: radius.md },
  slot: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  hint: { fontSize: fontSize.xs },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  flex: { flex: 1 },
});
