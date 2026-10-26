import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import {
  Badge,
  Button,
  ButtonRow,
  Callout,
  EmptyState,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { statusMeta } from '@/lib/status';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { mapBookingRpcError, staffSchedule } from '@/lib/bookingRules';
import {
  pickStaffForService,
  staffForService,
  staffServicesMap,
  type StaffServiceRow,
} from '@/lib/staffServices';
import { listBusyRanges } from '@/lib/bookingRpc';
import { staffOrUnassignedFilter } from '@/lib/calendarStaffFilter';
import { formatInTimeZone, localDayBoundsUtc } from '@/lib/timezone';
import { generateFreeSlots } from '@/lib/slots';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import { createWalkinAppointment } from '@/lib/walkin';
import { searchBusinessClients } from '@/lib/businessMembers';
import {
  fetchStaffUnavailability,
  type StaffUnavailability,
} from '@/lib/staffUnavailability';
import {
  searchWalkinClients,
  type WalkinClientCandidate,
} from '@/lib/walkinClientSearch';
import { normalizeWalkinContact, validateWalkinInput } from '@/lib/walkinRules';
import type { Appointment, BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

type CalendarStaff = Pick<Staff, 'id' | 'name' | 'color' | 'working_hours' | 'break_hours'>;

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

function mondayOfYmd(ymd: string): string {
  const d = new Date(ymd + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return toYmd(d);
}
export default function BusinessCalendarScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [rows, setRows] = useState<Appointment[]>([]);
  const [detailApt, setDetailApt] = useState<Appointment | null>(null);
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const dayInitRef = useRef(false);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [staffFilter, setStaffFilter] = useState<string | 'all'>('all');
  const [staffList, setStaffList] = useState<CalendarStaff[]>([]);
  const [error, setError] = useTransientMessage();
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [walkinServiceId, setWalkinServiceId] = useState<string | null>(null);
  const [walkinStaffId, setWalkinStaffId] = useState<string | null>(null);
  const [walkinStaffServices, setWalkinStaffServices] = useState<Record<string, string[]>>({});
  const [walkinSlots, setWalkinSlots] = useState<FreeSlot[]>([]);
  const [walkinSlotsLoading, setWalkinSlotsLoading] = useState(false);
  const [walkinSlot, setWalkinSlot] = useState<FreeSlot | null>(null);
  const [walkinPhone, setWalkinPhone] = useState('');
  const [walkinEmail, setWalkinEmail] = useState('');
  const [walkinSaving, setWalkinSaving] = useState(false);
  const [unavailRows, setUnavailRows] = useState<StaffUnavailability[]>([]);
  const [walkinClients, setWalkinClients] = useState<WalkinClientCandidate[]>([]);
  const [walkinError, setWalkinError] = useTransientMessage();
  const [walkinOk, setWalkinOk] = useTransientMessage();

  const load = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      setError(trKey('req.notAuthed'), { sticky: true });
      return;
    }
    const { data: biz, error: bErr } = await fetchMyBusinessResult(user.id);
    if (bErr) {
      setError(bErr.message, { sticky: true });
      setLoading(false);
      return;
    }
    if (!biz) {
      setBusiness(null);
      setRows([]);
      setLoading(false);
      return;
    }
    const profile = biz as BusinessProfile;
    setBusiness(profile);
    if (!dayInitRef.current && profile.timezone) {
      dayInitRef.current = true;
      setDateLocal(formatInTimeZone(new Date(), profile.timezone, 'yyyy-MM-dd'));
    }
    const { data: team } = await supabase
      .from('staff')
      .select('id, name, color, working_hours, break_hours')
      .eq('business_id', profile.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    setStaffList((team ?? []) as CalendarStaff[]);
    const rangeStart = viewMode === 'week' ? mondayOfYmd(dateLocal) : dateLocal;
    const rangeEnd = viewMode === 'week' ? addDaysYmd(rangeStart, 6) : dateLocal;
    const { startUtc } = localDayBoundsUtc(rangeStart, profile.timezone);
    const { endUtc } = localDayBoundsUtc(rangeEnd, profile.timezone);
    let query = supabase
      .from('appointments')
      .select('*')
      .eq('business_id', profile.id)
      .in('status', ['pending', 'approved'])
      .lt('start_at', endUtc.toISOString())
      .gt('end_at', startUtc.toISOString())
      .order('start_at', { ascending: true });
    if (staffFilter !== 'all') {
      const staffOr = staffOrUnassignedFilter(staffFilter);
      if (staffOr) query = query.or(staffOr);
    }
    const { rows: unavail } = await fetchStaffUnavailability({
      businessId: profile.id,
      fromYmd: rangeStart,
      toYmd: rangeEnd,
      staffId: staffFilter !== 'all' ? staffFilter : null,
    });
    setUnavailRows(unavail);
    const { data, error: aErr } = await query;
    if (aErr) {
      setError(aErr.message, { sticky: true });
    } else {
      setRows((data ?? []) as Appointment[]);
    }
    setLoading(false);
  }, [dateLocal, staffFilter, viewMode]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const blocked = useMemo(() => {
    const list = business?.blocked_dates ?? [];
    return list.includes(dateLocal);
  }, [business, dateLocal]);

  async function toggleBlockDay() {
    if (!business) return;
    setSaving(true);
    setError(null);
    const { data: fresh, error: readErr } = await supabase
      .from('business_profiles')
      .select('blocked_dates')
      .eq('id', business.id)
      .maybeSingle();
    if (readErr) {
      setSaving(false);
      setError(readErr.message);
      return;
    }
    const current = [...((fresh?.blocked_dates ?? business.blocked_dates ?? []) as string[])];
    const next = blocked
      ? current.filter((d) => d !== dateLocal)
      : [...current, dateLocal];
    const { error: err } = await supabase
      .from('business_profiles')
      .update({ blocked_dates: next, updated_at: new Date().toISOString() })
      .eq('id', business.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setBusiness({ ...business, blocked_dates: next });
  }

  const walkinTeam = useMemo(
    () => staffForService(staffList, walkinStaffServices, walkinServiceId),
    [staffList, walkinStaffServices, walkinServiceId]
  );

  const walkinSuggestions = useMemo(() => {
    const byPhone = searchWalkinClients(walkinClients, walkinPhone);
    if (byPhone.length > 0) return byPhone;
    return searchWalkinClients(walkinClients, walkinEmail);
  }, [walkinClients, walkinPhone, walkinEmail]);

  const walkinDuration = useMemo(() => {
    const svc = services.find((s) => s.id === walkinServiceId);
    return svc?.duration_minutes ?? business?.session_duration_minutes ?? 30;
  }, [services, walkinServiceId, business]);

  async function openWalkin() {
    if (!business) return;
    setWalkinError(null);
    setWalkinOk(null);
    setWalkinSlot(null);
    setWalkinOpen(true);
    setWalkinSlotsLoading(true);
    const [{ data: svcRows }, { data: offeredRows }] = await Promise.all([
      supabase
        .from('services')
        .select('*')
        .eq('business_id', business.id)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      staffList.length > 0
        ? supabase
            .from('staff_services')
            .select('staff_id, service_id')
            .in('staff_id', staffList.map((m) => m.id))
        : Promise.resolve({ data: [] as StaffServiceRow[] }),
    ]);
    const { clients } = await searchBusinessClients(business.id, '');
    setWalkinClients(clients);
    const list = (svcRows ?? []) as Service[];
    setServices(list);
    // Eroare de citire -> hartă goală = toți fac tot (ca la rezervarea publică).
    const offered = staffServicesMap(offeredRows as StaffServiceRow[] | null);
    setWalkinStaffServices(offered);
    const serviceId = walkinServiceId ?? list[0]?.id ?? null;
    setWalkinServiceId(serviceId);
    await reloadWalkinSlots(
      serviceId,
      staffFilter !== 'all' ? staffFilter : walkinStaffId,
      list,
      offered
    );
  }

  async function reloadWalkinSlots(
    serviceId: string | null,
    preferredStaffId: string | null,
    svcList: Service[] = services,
    offered: Record<string, string[]> = walkinStaffServices
  ) {
    if (!business) return;
    setWalkinSlotsLoading(true);
    setWalkinSlot(null);
    // Doar specialiștii care fac serviciul; programul lor, nu al firmei.
    const member = pickStaffForService(staffList, offered, serviceId, preferredStaffId);
    setWalkinStaffId(member?.id ?? null);
    if (staffList.length > 0 && !member) {
      setWalkinSlots([]);
      setWalkinSlotsLoading(false);
      return;
    }
    const svc = svcList.find((s) => s.id === serviceId);
    const duration = svc?.duration_minutes ?? business.session_duration_minutes;
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
    const { busy, error: busyErr } = await listBusyRanges({
      businessId: business.id,
      fromIso: startUtc.toISOString(),
      toIso: endUtc.toISOString(),
      staffId: member?.id ?? null,
    });
    if (busyErr) {
      setWalkinError(busyErr);
      setWalkinSlots([]);
      setWalkinSlotsLoading(false);
      return;
    }
    const hours = staffSchedule(member, business);
    const free = generateFreeSlots({
      dateLocal,
      timezone: business.timezone,
      sessionDurationMinutes: duration,
      workingHours: hours.workingHours,
      breakHours: hours.breakHours,
      busy,
      bufferMinutes: business.buffer_minutes ?? 0,
      blockedDates: business.blocked_dates ?? [],
      notBeforeUtc: new Date(),
    });
    setWalkinSlots(free);
    setWalkinSlotsLoading(false);
  }

  async function saveWalkin() {
    if (!business || !walkinSlot) {
      setWalkinError(trKey('cal.pickSlot'));
      return;
    }
    const { contact, error: contactErr } = normalizeWalkinContact(walkinPhone, walkinEmail);
    const invalid = validateWalkinInput({
      slotStartUtc: walkinSlot.startUtc,
      slotEndUtc: walkinSlot.endUtc,
      contactError: contactErr,
    });
    if (invalid) {
      setWalkinError(mapBookingRpcError(invalid));
      return;
    }
    setWalkinSaving(true);
    setWalkinError(null);
    const { error: err } = await createWalkinAppointment({
      businessId: business.id,
      startAt: walkinSlot.startUtc,
      endAt: walkinSlot.endUtc,
      serviceId: walkinServiceId,
      staffId: walkinStaffId,
      phone: contact.phone,
      email: contact.email,
    });
    setWalkinSaving(false);
    if (err) {
      setWalkinError(mapBookingRpcError(err));
      return;
    }
    const label = formatInTimeZone(new Date(walkinSlot.startUtc), business.timezone, 'HH:mm');
    setWalkinOk(trKey('cal.addedAt', { label }));
    setWalkinSlot(null);
    setWalkinPhone('');
    setWalkinEmail('');
    await load();
    await reloadWalkinSlots(walkinServiceId, walkinStaffId);
  }

  if (loading && !business) {
    return <SkeletonScreen title={tr('cal.title')} onBack={back} blocks={5} label={tr('cal.loading')} />;
  }

  if (!business) {
    return (
      <Screen title={tr('cal.title')} onBack={back}>
        <EmptyState
          icon="calendar-outline"
          title={tr('svc.setupFirst')}
          description={tr('cal.setupDesc')}
        />
      </Screen>
    );
  }

  return (
    <View style={styles.screenWrap}>
    <Screen
      title={tr('cal.title')}
      subtitle={business.name}
      onBack={back}
    >
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      <Segmented value={viewMode} onChange={(v) => setViewMode(v as 'day' | 'week')} options={[{ value: 'day', label: tr('cal.viewDay') }, { value: 'week', label: tr('cal.viewWeek') }]} />
      <DatePickerField label={tr('cal.day')} value={dateLocal} onChange={setDateLocal} />
      <Button
        label={blocked ? tr('cal.unblockDay') : tr('cal.blockDay')}
        icon={blocked ? 'lock-open-outline' : 'lock-closed-outline'}
        variant="secondary"
        size="sm"
        loading={saving}
        onPress={() => void toggleBlockDay()}
      />

      {staffList.length > 1 ? (
        <View style={styles.filters}>
          <Pressable
            onPress={() => setStaffFilter('all')}
            style={[
              styles.chip,
              {
                backgroundColor: staffFilter === 'all' ? t.colors.accent : t.colors.surface,
                borderColor: t.colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: staffFilter === 'all' ? t.colors.onAccent : t.colors.text,
                fontWeight: '700',
                fontSize: fontSize.sm,
              }}
            >
              {tr('cal.all')}
            </Text>
          </Pressable>
          {staffList.map((s) => {
            const on = staffFilter === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setStaffFilter(s.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? t.colors.accent : t.colors.surface,
                    borderColor: t.colors.border,
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
                  {s.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {blocked ? (
        <Callout tone="warning" title={tr('cal.blockedDay')}>
          {tr('cal.blockedBody')}
        </Callout>
      ) : null}

      {unavailRows.map((u) => (
        <Callout key={u.id} tone="warning">
          {tr('unavail.day', {
            name: staffList.find((s) => s.id === u.staff_id)?.name ?? '',
            reason: u.reason ?? `${u.start_date} -> ${u.end_date}`,
          })}
        </Callout>
      ))}

      {rows.length === 0 ? (
        <EmptyState
          icon="sunny-outline"
          title={blocked ? tr('cal.closedDay') : tr('cal.noAppts')}
          description={
            blocked
              ? tr('cal.closedDesc')
              : tr('cal.noApptsDesc')
          }
          compact
        />
      ) : (
        rows.map((a) => {
          const meta = statusMeta(a.status);
          const start = formatInTimeZone(new Date(a.start_at), business.timezone, 'HH:mm');
          const end = formatInTimeZone(new Date(a.end_at), business.timezone, 'HH:mm');
          const contact = [a.client_email, a.client_phone].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={a.id}
              onPress={() => {
                if (viewMode === 'week') {
                  setDateLocal(formatInTimeZone(new Date(a.start_at), business.timezone, 'yyyy-MM-dd'));
                  setViewMode('day');
                } else {
                  setDetailApt(a);
                }
              }}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: t.colors.surface,
                  borderColor: t.colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.timeCol, { borderRightColor: t.colors.border }]}>
                {viewMode === 'week' ? (
                  <Text style={[styles.timeEnd, { color: t.colors.accent }]}>
                    {formatInTimeZone(new Date(a.start_at), business.timezone, 'dd.MM')}
                  </Text>
                ) : null}
                <Text style={[styles.timeStart, { color: t.colors.text }]}>{start}</Text>
                <Text style={[styles.timeEnd, { color: t.colors.textFaint }]}>{end}</Text>
              </View>
              <View style={styles.itemBody}>
                <View style={styles.itemHead}>
                  <Text style={[styles.itemTitle, { color: t.colors.text }]} numberOfLines={1}>
                    {a.service_name ?? tr('cli.session')}
                    {a.staff_name ? ` · ${a.staff_name}` : ''}
                  </Text>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                  {a.checked_in_at ? (
                    <Badge tone="accent">{tr('appt.checkedIn')}</Badge>
                  ) : null}
                  {!a.staff_id && staffList.length > 0 ? (
                    <Badge tone="warning">{tr('cal.noStaff')}</Badge>
                  ) : null}
                </View>
                {a.no_show ? (
                  <Text style={[styles.contact, { color: t.colors.danger }]}>{tr('cli.noShow')}</Text>
                ) : null}
                {contact ? (
                  <View style={styles.contactRow}>
                    <Ionicons name="person-outline" size={13} color={t.colors.textFaint} />
                    <Text style={[styles.contact, { color: t.colors.textMuted }]} numberOfLines={1}>
                      {contact}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
      <Modal
        visible={walkinOpen}
        animationType="slide"
        transparent
        onRequestClose={() => !walkinSaving && setWalkinOpen(false)}
        statusBarTranslucent
      >
        <View style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}>
          <View style={[styles.modalCard, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: t.colors.text }]} numberOfLines={2}>
                {tr('cal.walkinTitle', { date: dateLocal })}
              </Text>
              <Pressable
                onPress={() => !walkinSaving && setWalkinOpen(false)}
                accessibilityRole="button"
                accessibilityLabel={tr('common.close')}
                hitSlop={8}
              >
                <Ionicons name="close" size={22} color={t.colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              {walkinError ? <Callout onClose={() => setWalkinError(null)} tone="danger">{walkinError}</Callout> : null}
              {walkinOk ? <Callout onClose={() => setWalkinOk(null)} tone="success">{walkinOk}</Callout> : null}
              {services.length > 0 ? (
                <>
                  <SectionTitle>{tr('cal.serviceMin', { mins: walkinDuration })}</SectionTitle>
                  <View style={styles.filters}>
                    {services.map((s) => {
                      const on = walkinServiceId === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => {
                            setWalkinServiceId(s.id);
                            void reloadWalkinSlots(s.id, walkinStaffId);
                          }}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: on ? t.colors.accent : t.colors.surface,
                              borderColor: t.colors.border,
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
                            {s.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
              {staffList.length > 0 && walkinTeam.length === 0 ? (
                <Callout tone="warning">{tr('book.errStaffService')}</Callout>
              ) : null}
              {walkinTeam.length > 0 ? (
                <>
                  <SectionTitle>{tr('team.specialist')}</SectionTitle>
                  <View style={styles.filters}>
                    {walkinTeam.map((s) => {
                      const on = walkinStaffId === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => {
                            void reloadWalkinSlots(walkinServiceId, s.id);
                          }}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: on ? t.colors.accent : t.colors.surface,
                              borderColor: t.colors.border,
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
                            {s.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
              <SectionTitle>{tr('req.freeSlot')}</SectionTitle>
              {walkinSlotsLoading ? (
                <Text style={{ color: t.colors.textMuted }}>{tr('req.calcSlots')}</Text>
              ) : walkinSlots.length === 0 ? (
                <Text style={{ color: t.colors.textMuted }}>
                  {tr('cal.noSlots', { date: dateLocal })}
                </Text>
              ) : (
                <View style={styles.slotGrid}>
                  {walkinSlots.map((slot) => {
                    const on = walkinSlot?.startUtc === slot.startUtc;
                    return (
                      <Pressable
                        key={slot.startUtc}
                        onPress={() => setWalkinSlot(slot)}
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
              <SectionTitle>{tr('cal.contact')}</SectionTitle>
              <Field
                label={tr('cal.phone')}
                placeholder="07…"
                keyboardType="phone-pad"
                value={walkinPhone}
                onChangeText={setWalkinPhone}
              />
              <Field
                label={tr('cal.email')}
                placeholder="client@exemplu.ro"
                keyboardType="email-address"
                autoCapitalize="none"
                value={walkinEmail}
                onChangeText={setWalkinEmail}
              />
              <Text style={[styles.walkinHint, { color: t.colors.textFaint }]}>
              {walkinSuggestions.length > 0 ? (
                <>
                  <SectionTitle>{tr('walkin.clientSearch')}</SectionTitle>
                  {walkinSuggestions.map((c) => (
                    <Pressable
                      key={c.clientUserId}
                      onPress={() => {
                        if (c.phone) setWalkinPhone(c.phone);
                        if (c.email) setWalkinEmail(c.email);
                        setWalkinOk(trKey('walkin.existingFilled'));
                      }}
                      style={[styles.chip, { backgroundColor: t.colors.surface, borderColor: t.colors.border, alignSelf: 'flex-start' }]}
                    >
                      <Text style={{ color: t.colors.text, fontWeight: '700', fontSize: fontSize.sm }}>
                        {[c.displayName, c.phone ?? c.email].filter(Boolean).join(' - ')}
                      </Text>
                    </Pressable>
                  ))}
                </>
              ) : null}
                {tr('cal.walkinHint')}
              </Text>
            </ScrollView>
            <ButtonRow>
              <View style={styles.actionFlex}>
                <Button
                  label={tr('common.close')}
                  variant="secondary"
                  size="sm"
                  disabled={walkinSaving}
                  onPress={() => setWalkinOpen(false)}
                />
              </View>
              <View style={styles.actionFlex}>
                <Button
                  label={tr('common.save')}
                  icon="checkmark"
                  variant="primary"
                  size="sm"
                  loading={walkinSaving}
                  disabled={!walkinSlot || walkinSaving}
                  onPress={() => void saveWalkin()}
                />
              </View>
            </ButtonRow>
          </View>
        </View>
      </Modal>
    </Screen>
    <Pressable
      onPress={() => void openWalkin()}
      accessibilityRole="button"
      accessibilityLabel={tr('cal.addWalkin')}
      style={({ pressed }) => [styles.fab, { backgroundColor: t.colors.accent, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name="add" size={20} color={t.colors.onAccent} />
      <Text style={[styles.fabText, { color: t.colors.onAccent }]}>{tr('cal.addWalkin')}</Text>
    </Pressable>
    <Modal
      visible={detailApt !== null}
      animationType="slide"
      transparent
      onRequestClose={() => setDetailApt(null)}
      statusBarTranslucent
    >
      <View style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}>
        <View style={[styles.modalCard, { backgroundColor: t.colors.bgElevated, borderColor: t.colors.border }]}>
          <View style={styles.modalHead}>
            <Text style={[styles.modalTitle, { color: t.colors.text }]} numberOfLines={2}>
              {tr('cal.tapDetails')}
            </Text>
            <Pressable onPress={() => setDetailApt(null)} accessibilityRole="button" accessibilityLabel={tr('common.close')} hitSlop={8}>
              <Ionicons name="close" size={22} color={t.colors.textMuted} />
            </Pressable>
          </View>
          {detailApt ? (
            <>
              <Text style={{ color: t.colors.text, fontWeight: '700', fontSize: fontSize.md }}>
                {detailApt.service_name ?? tr('cli.session')}{detailApt.staff_name ? ` - ${detailApt.staff_name}` : ''}
              </Text>
              <Text style={{ color: t.colors.textMuted }}>
                {formatInTimeZone(new Date(detailApt.start_at), business.timezone, 'dd.MM.yyyy HH:mm')} - {formatInTimeZone(new Date(detailApt.end_at), business.timezone, 'HH:mm')}
              </Text>
              {[detailApt.client_email, detailApt.client_phone].filter(Boolean).length > 0 ? (
                <Text style={{ color: t.colors.textMuted }}>
                  {[detailApt.client_email, detailApt.client_phone].filter(Boolean).join(' - ')}
                </Text>
              ) : null}
              {detailApt.no_show ? (
                <Text style={{ color: t.colors.danger, fontWeight: '700' }}>{tr('cli.noShow')}</Text>
              ) : null}
              <ButtonRow>
                <View style={styles.actionFlex}>
                  <Button label={tr('common.close')} variant="secondary" size="sm" onPress={() => setDetailApt(null)} />
                </View>
                <View style={styles.actionFlex}>
                  <Button
                    label={tr('cal.viewRequests')}
                    icon="hourglass-outline"
                    size="sm"
                    onPress={() => { setDetailApt(null); router.push('/(app)/business/(tabs)/requests'); }}
                  />
                </View>
              </ButtonRow>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrap: { flex: 1 },
  fab: { position: 'absolute', right: spacing.md, bottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: 999 },
  fabText: { fontWeight: '800', fontSize: fontSize.sm },
  item: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  timeCol: {
    width: 72,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  timeStart: { fontSize: fontSize.md, fontWeight: '800' },
  timeEnd: { fontSize: fontSize.xs, fontWeight: '600' },
  itemBody: { flex: 1, padding: spacing.md, gap: 6 },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contact: { fontSize: fontSize.sm, flexShrink: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.md,
  },
  modalCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalTitle: { flex: 1, fontSize: fontSize.lg, fontWeight: '800' },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  slot: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  walkinHint: { fontSize: fontSize.xs, marginTop: spacing.xs },
  actionFlex: { flex: 1 },
});
