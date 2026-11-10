/**
 * v101 (3.03): programare rapidă din business. Deschisă din Calendar (FAB) și din Clienți
 * („Programează"). Client după telefon (autocomplete pe server), mai multe servicii,
 * specialist care le face pe toate, zi din calendar (doar azi și zilele viitoare, zile închise/blocate gri)
 * + slot liber pe durata totală (doar ore viitoare), notă și „Anunță clientul" (implicit OPRIT, mereu vizibil sub listă).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BookingCalendar } from '@/components/BookingCalendar';
import { Button, ButtonRow, Callout, Field, SectionTitle, Toggle, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { trKey, useT } from '@/lib/i18n';
import { bookingDateRange } from '@/lib/bookingCalendar';
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

/**
 * Corpul se montează la fiecare deschidere: starea pornește din props (zi, client, specialist),
 * fără reset într-un effect — altfel primul cadru afișa ziua/serviciile deschiderii anterioare
 * și banda de zile rămânea derulată la ziua veche.
 */
export function QuickAddAppointmentSheet(props: Props) {
  return props.visible ? <QuickAddBody {...props} /> : null;
}

function QuickAddBody({
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
  const [{ minYmd: today, maxYmd }] = useState(() => bookingDateRange(business));

  const [staffList, setStaffList] = useState<QuickAddStaff[]>(staffProp ?? []);
  const [services, setServices] = useState<Service[]>([]);
  const [offered, setOffered] = useState<Record<string, string[]>>({});
  const [myStaffId, setMyStaffId] = useState<string | null>(null);
  const [isStaffRole, setIsStaffRole] = useState(false);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [day, setDay] = useState(initialDate && initialDate > today ? initialDate : today);
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<FreeSlot | null>(null);
  const [picked, setPicked] = useState<BusinessClientContact | null>(initialClient ?? null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatWeeks, setRepeatWeeks] = useState(2);
  const [notify, setNotify] = useState(false);
  const [suggestions, setSuggestions] = useState<BusinessClientContact[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const scrollViewH = useRef(0);
  const contentH = useRef(0);
  const slotsY = useRef(0);

  // Încărcare la montare (= la fiecare deschidere).
  useEffect(() => {
    let alive = true;
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
  }, [business.id]);

  const totals = useMemo(() => comboTotals(services, serviceIds), [services, serviceIds]);
  const eligible = useMemo(
    () => staffForServices(staffList, offered, serviceIds),
    [staffList, offered, serviceIds]
  );
  const member = useMemo(() => {
    if (staffList.length === 0) return null;
    return eligible.find((m) => m.id === staffId) ?? eligible[0] ?? null;
  }, [eligible, staffId, staffList.length]);

  const schedule = staffSchedule(member, business);

  // Sloturi libere pe durata totală, doar de acum înainte (fără preaviz minim: business-ul notează direct).
  useEffect(() => {
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
              notBeforeUtc: new Date(),
            })
      );
      setSlotsLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [day, member, totals.durationMinutes, business, tz, staffList.length]);

  // Autocomplete client (telefon / nume) pe server, cu debounce.
  useEffect(() => {
    if (picked) return;
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
  }, [phone, name, picked, business.id]);

  // Ziua aleasa: zona de ore (sau motivul pentru care lipsesc) urca in vedere, ziua ramane deasupra.
  function pickDay(ymd: string) {
    setDay(ymd);
    const target = Math.min(slotsY.current + SLOTS_REVEAL - scrollViewH.current, contentH.current - scrollViewH.current);
    if (target > scrollY.current) scrollRef.current?.scrollTo({ y: target, animated: true });
  }

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
    const repeatCount = repeatEnabled ? repeatWeeks : 1;
    setSaving(true);
    const { appointment, appointments, error: err } = await createBusinessAppointment({
      businessId: business.id,
      staffId: member?.id ?? null,
      payload,
      note,
      notifyClient: notify && !isStaffRole,
      repeatCount,
    });
    if (err) {
      setSaving(false);
      setError(mapQuickAddError(err, repeatCount));
      return;
    }
    // Toggle PORNIT: confirmarea către client (email/WhatsApp) pleacă prin notify-decision.
    if (notify && !isStaffRole) {
      for (const row of appointments) {
        if (row.id) await invokeDecisionNotify(row.id);
      }
    }
    setSaving(false);
    const label = formatInTimeZone(new Date(payload.p_start_at), tz, 'dd.MM HH:mm');
    setOk(
      repeatCount > 1
        ? trKey('qa.addedSeries', { n: repeatCount, label })
        : trKey('cal.addedAt', { label })
    );
    setSlot(null);
    setRepeatEnabled(false);
    setRepeatWeeks(2);
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
    <Modal visible animationType="slide" transparent onRequestClose={() => !saving && onClose()} statusBarTranslucent>
      <View style={[styles.backdrop, { backgroundColor: t.colors.overlay, paddingTop: insets.top + spacing.md, paddingBottom: spacing.md + insets.bottom }]}>
        <View style={[styles.card, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: t.colors.text }]} numberOfLines={1}>
              {tr('qa.title')}
            </Text>
            <Pressable onPress={() => !saving && onClose()} accessibilityRole="button" accessibilityLabel={tr('common.close')} hitSlop={8}>
              <Ionicons name="close" size={22} color={t.colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={{ gap: spacing.sm }}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={64}
            onScroll={(e) => {
              scrollY.current = e.nativeEvent.contentOffset.y;
            }}
            onLayout={(e) => {
              scrollViewH.current = e.nativeEvent.layout.height;
            }}
            onContentSizeChange={(_w, h) => {
              contentH.current = h;
            }}
          >
            {error ? <Callout tone="danger" onClose={() => setError(null)}>{error}</Callout> : null}
            {ok ? <Callout tone="success" onClose={() => setOk(null)}>{ok}</Callout> : null}

            <SectionTitle>{tr('qa.client')}</SectionTitle>
            {picked ? (
              <View style={[styles.pickedRow, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}>
                <Ionicons name="person-circle-outline" size={22} color={t.colors.accent} />
                <View style={{ flex: 1, minWidth: 0 }}>
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
                  autoComplete="off"
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
            <BookingCalendar
              value={day}
              onChange={pickDay}
              minYmd={today}
              maxYmd={maxYmd}
              blockedDates={business.blocked_dates ?? []}
              schedules={[schedule.workingHours]}
              heat={
                totals.durationMinutes > 0 && (staffList.length === 0 || member)
                  ? {
                      kind: 'client',
                      business,
                      members: [member],
                      durationMinutes: totals.durationMinutes,
                      minYmd: today,
                      maxYmd,
                      ignoreMinNotice: true,
                    }
                  : null
              }
            />

            <View
              style={{ gap: spacing.sm }}
              onLayout={(e) => {
                slotsY.current = e.nativeEvent.layout.y;
              }}
            >
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
                    return (
                      <Pressable
                        key={s.startUtc}
                        onPress={() => setSlot(s)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[
                          styles.slot,
                          on
                            ? { backgroundColor: t.colors.accent, borderColor: t.colors.accentPressed }
                            : { backgroundColor: t.colors.surface, borderColor: t.colors.borderStrong },
                        ]}
                      >
                        <Text
                          style={{
                            fontSize: fontSize.sm,
                            color: on ? t.colors.onAccent : t.colors.text,
                            fontWeight: on ? '800' : '700',
                          }}
                        >
                          {s.labelLocal}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <SectionTitle>{tr('qa.repeat')}</SectionTitle>
            <View style={styles.notifyRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.colors.text, fontWeight: '700' }}>{tr('qa.repeatEnable')}</Text>
                <Text style={[styles.hint, { color: t.colors.textMuted }]}>
                  {repeatEnabled ? tr('qa.repeatHint') : tr('qa.repeatOffHint')}
                </Text>
              </View>
              <Toggle
                value={repeatEnabled}
                onValueChange={setRepeatEnabled}
                accessibilityLabel={tr('qa.repeatEnable')}
              />
            </View>
            {repeatEnabled ? (
              <View style={styles.wrap} accessibilityRole="radiogroup">
                {([2, 3, 4] as const).map((count) => {
                  const on = repeatWeeks === count;
                  const key = `qa.weeks${count}` as const;
                  return (
                    <Pressable
                      key={count}
                      onPress={() => setRepeatWeeks(count)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={tr(key)}
                      style={chip(on)}
                    >
                      <Text style={chipText(on)}>{tr(key)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Field label={tr('qa.note')} placeholder={tr('qa.notePh')} value={note} onChangeText={setNote} multiline maxLength={500} />
          </ScrollView>
          {isStaffRole ? null : (
            <View style={styles.notifyRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: t.colors.text, fontWeight: '700' }}>{tr('qa.notify')}</Text>
                <Text style={[styles.hint, { color: t.colors.textMuted }]}>{tr('qa.notifyHint')}</Text>
              </View>
              <Toggle value={notify} onValueChange={setNotify} accessibilityLabel={tr('qa.notify')} />
            </View>
          )}
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

/** cat din zona de ore trebuie sa se vada dupa alegerea zilei: titlul + ~2 randuri de ore */
const SLOTS_REVEAL = 132;

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.md, paddingTop: spacing.md },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, gap: spacing.md, maxHeight: '100%', width: '100%', maxWidth: 640, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.lg, fontWeight: '800' },
  scroll: { flexShrink: 1 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1 },
  slot: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 2 },
  hint: { fontSize: fontSize.xs },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  flex: { flex: 1 },
});
