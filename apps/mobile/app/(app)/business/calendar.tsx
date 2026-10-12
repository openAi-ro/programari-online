import { useCallback, useMemo, useState } from 'react';
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
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { statusMeta } from '@/lib/status';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { mapBookingRpcError } from '@/lib/bookingRules';
import { listBusyRanges } from '@/lib/bookingRpc';
import { formatInTimeZone, localDayBoundsUtc } from '@/lib/timezone';
import { generateFreeSlots } from '@/lib/slots';
import { supabase } from '@/lib/supabase';
import { createWalkinAppointment } from '@/lib/walkin';
import { normalizeWalkinContact, validateWalkinInput } from '@/lib/walkinRules';
import type { Appointment, BusinessProfile, FreeSlot, Service } from '@/lib/types';

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [staffFilter, setStaffFilter] = useState<string | 'all'>('all');
  const [staffList, setStaffList] = useState<{ id: string; name: string; color: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [walkinServiceId, setWalkinServiceId] = useState<string | null>(null);
  const [walkinStaffId, setWalkinStaffId] = useState<string | null>(null);
  const [walkinSlots, setWalkinSlots] = useState<FreeSlot[]>([]);
  const [walkinSlotsLoading, setWalkinSlotsLoading] = useState(false);
  const [walkinSlot, setWalkinSlot] = useState<FreeSlot | null>(null);
  const [walkinPhone, setWalkinPhone] = useState('');
  const [walkinEmail, setWalkinEmail] = useState('');
  const [walkinSaving, setWalkinSaving] = useState(false);
  const [walkinError, setWalkinError] = useState<string | null>(null);
  const [walkinOk, setWalkinOk] = useState<string | null>(null);

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
    const { data: biz, error: bErr } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('owner_user_id', user.id)
      .maybeSingle();
    if (bErr) {
      setError(bErr.message);
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
    const { data: team } = await supabase
      .from('staff')
      .select('id, name, color')
      .eq('business_id', profile.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    setStaffList((team ?? []) as { id: string; name: string; color: string }[]);
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, profile.timezone);
    let query = supabase
      .from('appointments')
      .select('*')
      .eq('business_id', profile.id)
      .in('status', ['pending', 'approved'])
      .lt('start_at', endUtc.toISOString())
      .gt('end_at', startUtc.toISOString())
      .order('start_at', { ascending: true });
    if (staffFilter !== 'all') query = query.eq('staff_id', staffFilter);
    const { data, error: aErr } = await query;
    if (aErr) {
      setError(aErr.message);
    } else {
      setRows((data ?? []) as Appointment[]);
    }
    setLoading(false);
  }, [dateLocal, staffFilter]);

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
    const current = [...(business.blocked_dates ?? [])];
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
    const { data: svcRows } = await supabase
      .from('services')
      .select('*')
      .eq('business_id', business.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    const list = (svcRows ?? []) as Service[];
    setServices(list);
    if (!walkinServiceId && list.length > 0) setWalkinServiceId(list[0].id);
    if (!walkinStaffId) {
      setWalkinStaffId(staffFilter !== 'all' ? staffFilter : (staffList[0]?.id ?? null));
    }
    await reloadWalkinSlots(
      (walkinServiceId ?? list[0]?.id ?? null),
      (staffFilter !== 'all' ? staffFilter : (walkinStaffId ?? staffList[0]?.id ?? null)),
      list
    );
  }

  async function reloadWalkinSlots(
    serviceId: string | null,
    staffId: string | null,
    svcList: Service[] = services
  ) {
    if (!business) return;
    setWalkinSlotsLoading(true);
    setWalkinSlot(null);
    const svc = svcList.find((s) => s.id === serviceId);
    const duration = svc?.duration_minutes ?? business.session_duration_minutes;
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
    const { busy, error: busyErr } = await listBusyRanges({
      businessId: business.id,
      fromIso: startUtc.toISOString(),
      toIso: endUtc.toISOString(),
      staffId,
    });
    if (busyErr) {
      setWalkinError(busyErr);
      setWalkinSlots([]);
      setWalkinSlotsLoading(false);
      return;
    }
    const free = generateFreeSlots({
      dateLocal,
      timezone: business.timezone,
      sessionDurationMinutes: duration,
      workingHours: business.working_hours,
      breakHours: business.break_hours,
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
    <Screen
      title={tr('cal.title')}
      subtitle={business.name}
      onBack={back}
      footer={
        <View style={styles.footer}>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button
            label={blocked ? tr('cal.unblockDay') : tr('cal.blockDay')}
            icon={blocked ? 'lock-open-outline' : 'lock-closed-outline'}
            variant={blocked ? 'secondary' : 'danger'}
            loading={saving}
            onPress={() => void toggleBlockDay()}
          />
          <Button
            label={tr('cal.addWalkin')}
            icon="add-circle-outline"
            onPress={() => void openWalkin()}
          />
          <Button
            label={tr('cal.viewRequests')}
            variant="secondary"
            icon="hourglass-outline"
            onPress={() => router.push('/(app)/business/(tabs)/requests')}
          />
        </View>
      }
    >
      <DatePickerField label={tr('cal.day')} value={dateLocal} onChange={setDateLocal} />

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
              onPress={() => router.push('/(app)/business/(tabs)/requests')}
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
              {walkinError ? <Callout tone="danger">{walkinError}</Callout> : null}
              {walkinOk ? <Callout tone="success">{walkinOk}</Callout> : null}
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
              {staffList.length > 0 ? (
                <>
                  <SectionTitle>{tr('team.specialist')}</SectionTitle>
                  <View style={styles.filters}>
                    {staffList.map((s) => {
                      const on = walkinStaffId === s.id;
                      return (
                        <Pressable
                          key={s.id}
                          onPress={() => {
                            setWalkinStaffId(s.id);
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
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
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
