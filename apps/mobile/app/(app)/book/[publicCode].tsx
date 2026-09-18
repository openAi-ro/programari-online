import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import { LocationCard } from '@/components/LocationCard';
import { SlotPicker } from '@/components/SlotPicker';
import {
  Badge,
  Button,
  Callout,
  ErrorState,
  Screen,
  SectionTitle,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  firstBookableDateYmd,
  mapBookingRpcError,
  maxBookingDate,
  notBeforeUtc,
  staffSchedule,
  toYmd,
} from '@/lib/bookingRules';
import { createAppointmentIfFree, listBusyRanges, notifyAfterBooking } from '@/lib/bookingRpc';
import { formatDuration, formatLei, formatRon } from '@/lib/format';
import { useBack } from '@/lib/nav';
import { locationFromBusiness } from '@/lib/location';
import { markWaitlistBooked, invokePendingPush } from '@/lib/notify-client';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { generateFreeSlots } from '@/lib/slots';
import { localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';

export default function BookScreen() {
  const t = useTheme();
  const router = useRouter();
  const { publicCode, rescheduleId } = useLocalSearchParams<{
    publicCode: string;
    rescheduleId?: string;
  }>();
  const goBack = useBack();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [waitlistBusy, setWaitlistBusy] = useState(false);

  const isReschedule = Boolean(rescheduleId);
  const selectedService = useMemo(
    () => services.find((s) => s.id === serviceId) ?? null,
    [services, serviceId]
  );
  const selectedStaff = useMemo(
    () => staffList.find((s) => s.id === staffId) ?? null,
    [staffList, staffId]
  );

  const durationMinutes =
    selectedService?.duration_minutes ?? business?.session_duration_minutes ?? 60;

  const minDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const maxDate = useMemo(
    () => (business ? maxBookingDate(business) : minDate),
    [business, minDate]
  );

  useEffect(() => {
    (async () => {
      setError(null);
      const code = String(publicCode ?? '').trim();
      if (!code) {
        setError('Cod business invalid.');
        setLoading(false);
        return;
      }
      const { data, error: err } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('public_code', code)
        .maybeSingle();
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      if (!data) {
        setError('Business-ul nu a fost găsit.');
        setLoading(false);
        return;
      }
      const biz = data as BusinessProfile;
      biz.blocked_dates = Array.isArray(biz.blocked_dates) ? biz.blocked_dates : [];
      setBusiness(biz);

      const { data: svcRows } = await supabase
        .from('services')
        .select('*')
        .eq('business_id', biz.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      const list = (svcRows ?? []) as Service[];
      setServices(list);
      if (list.length > 0) setServiceId(list[0].id);

      const { data: staffRows } = await supabase
        .from('staff')
        .select('*')
        .eq('business_id', biz.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      const team = (staffRows ?? []) as Staff[];
      setStaffList(team);
      if (team.length > 0) setStaffId(team[0].id);

      const hours = staffSchedule(team[0] ?? null, biz);
      setDateLocal(
        firstBookableDateYmd({
          timezone: biz.timezone,
          workingHours: hours.workingHours,
          breakHours: hours.breakHours,
          blockedDates: biz.blocked_dates ?? [],
          minNoticeMinutes: biz.min_notice_minutes ?? 0,
          maxAdvanceDays: biz.max_advance_days ?? 90,
          sessionDurationMinutes:
            list[0]?.duration_minutes ?? biz.session_duration_minutes ?? 60,
          bufferMinutes: biz.buffer_minutes ?? 0,
        })
      );

      if (rescheduleId) {
        const { data: apt } = await supabase
          .from('appointments')
          .select('service_id, staff_id')
          .eq('id', String(rescheduleId))
          .maybeSingle();
        if (apt?.service_id && list.some((s) => s.id === apt.service_id)) {
          setServiceId(apt.service_id as string);
        }
        if (apt?.staff_id && team.some((s) => s.id === apt.staff_id)) {
          setStaffId(apt.staff_id as string);
        }
      }
      setLoading(false);
    })();
  }, [publicCode, rescheduleId]);

  const loadSlots = useCallback(async () => {
    if (!business) return;
    setSlotsLoading(true);
    setSelected(null);
    setError(null);
    setMessage(null);

    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
    const { busy: rawBusy, error: err } = await listBusyRanges({
      businessId: business.id,
      fromIso: startUtc.toISOString(),
      toIso: endUtc.toISOString(),
      staffId,
    });

    if (err) {
      setError(err);
      setSlots([]);
      setSlotsLoading(false);
      return;
    }

    let busy = rawBusy;
    if (rescheduleId) {
      const { data: current } = await supabase
        .from('appointments')
        .select('start_at, end_at')
        .eq('id', String(rescheduleId))
        .maybeSingle();
      if (current?.start_at) {
        busy = rawBusy.filter(
          (b) => !(b.startUtc === current.start_at && b.endUtc === current.end_at)
        );
      }
    }

    const hours = staffSchedule(selectedStaff, business);
    const free = generateFreeSlots({
      dateLocal,
      timezone: business.timezone,
      sessionDurationMinutes: durationMinutes,
      workingHours: hours.workingHours,
      breakHours: hours.breakHours,
      busy,
      bufferMinutes: business.buffer_minutes ?? 0,
      blockedDates: business.blocked_dates ?? [],
      notBeforeUtc: notBeforeUtc(business),
    });
    setSlots(free);
    setSlotsLoading(false);
  }, [business, dateLocal, durationMinutes, rescheduleId, staffId, selectedStaff]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  async function handleBook() {
    if (!business || !selected) {
      setError('Alege un slot.');
      return;
    }
    if (services.length > 0 && !serviceId) {
      setError('Alege un serviciu.');
      return;
    }
    setBooking(true);
    setError(null);
    setMessage(null);

    if (isReschedule && rescheduleId) {
      const { error: err } = await supabase.rpc('reschedule_appointment', {
        p_appointment_id: String(rescheduleId),
        p_start_at: selected.startUtc,
        p_end_at: selected.endUtc,
      });
      setBooking(false);
      if (err) {
        setError(mapBookingRpcError(err.message));
        await loadSlots();
        return;
      }
      // Anunță business-ul că s-a mutat ora — altfel, cu app-ul închis,
      // nu află decât când deschide calendarul.
      const { data: moved } = await supabase
        .from('appointments')
        .select('id, business_id, status, client_email, client_phone, start_at')
        .eq('id', String(rescheduleId))
        .maybeSingle();
      if (moved?.id && moved?.business_id) {
        const notify = await invokePendingPush(
          {
            id: moved.id,
            business_id: moved.business_id,
            status: moved.status ?? 'approved',
            client_email: moved.client_email,
            client_phone: moved.client_phone,
            start_at: moved.start_at,
          },
          { reason: 'rescheduled' }
        );
        if (!notify.ok) {
          console.warn('notify after reschedule failed', notify.error);
        }
      }
      setSelected(null);
      setMessage('Programarea a fost mutată.');
      setTimeout(() => router.replace('/(app)/my-appointments'), 800);
      return;
    }

    const { appointment: created, error: err } = await createAppointmentIfFree({
      businessId: business.id,
      startAt: selected.startUtc,
      endAt: selected.endUtc,
      serviceId,
      staffId,
    });

    setBooking(false);
    if (err) {
      setError(mapBookingRpcError(err));
      await loadSlots();
      return;
    }

    const appointment = created;
    if (appointment?.id) {
      const notify = await notifyAfterBooking(appointment);
      if (!notify.ok) {
        console.warn('notify after book failed', notify.error);
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await markWaitlistBooked({
          businessId: business.id,
          clientUserId: user.id,
          desiredDate: dateLocal,
        });
      }
      if (appointment.payment_status === 'unpaid') {
        const pay = await startDepositCheckout(appointment.id);
        if (!pay.ok && pay.error !== 'stripe_not_configured') {
          setError(mapPayError(pay.error ?? 'checkout_failed'));
        }
      }
    }

    setSelected(null);
    await loadSlots();
    if (appointment?.loyalty_redeemed) {
      setMessage('Ședință cadou (loialitate). Cererea a fost trimisă.');
    } else if (appointment?.status === 'approved') {
      setMessage(
        appointment.payment_status === 'unpaid'
          ? `Programarea e confirmată. Avans: ${formatLei(appointment.deposit_ron)}.`
          : 'Programarea a fost confirmată automat.'
      );
    } else {
      setMessage(
        appointment?.payment_status === 'unpaid'
          ? `Cererea a fost trimisă. Avans: ${formatLei(appointment.deposit_ron)}. Așteaptă confirmarea.`
          : 'Cererea a fost trimisă. Așteaptă confirmarea.'
      );
    }
    if (appointment?.id) {
      setTimeout(() => router.replace('/(app)/my-appointments'), 600);
    }
  }

  async function handleWaitlist() {
    if (!business) return;
    setWaitlistBusy(true);
    setError(null);
    setMessage(null);
    const { error: err } = await supabase.rpc('join_waitlist', {
      p_business_id: business.id,
      p_desired_date: dateLocal,
      p_service_id: serviceId,
      p_staff_id: staffId,
    });
    setWaitlistBusy(false);
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    setMessage('Te-am pus pe lista de așteptare. Te anunțăm dacă se eliberează un loc.');
  }

  if (loading) {
    return (
      <SkeletonScreen title="Rezervare" onBack={goBack} blocks={5} label="Căutăm agenda…" />
    );
  }

  if (!business) {
    return (
      <Screen title="Rezervare" onBack={goBack}>
        <ErrorState
          title="Nu am putut încărca business-ul"
          description={error ?? 'Eroare necunoscută.'}
          action={<Button label="Înapoi" variant="secondary" onPress={goBack} />}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={isReschedule ? 'Reprogramare' : business.name}
      subtitle={
        selectedService
          ? `${selectedService.name} · ${formatDuration(selectedService.duration_minutes)}`
          : `${durationMinutes} min · ${business.timezone}`
      }
      onBack={goBack}
      footer={
        <>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {message ? <Callout tone="success">{message}</Callout> : null}
          <Button
            label={
              booking
                ? 'Se trimite…'
                : isReschedule
                  ? 'Mută programarea'
                  : 'Trimite cererea'
            }
            icon="paper-plane-outline"
            onPress={handleBook}
            loading={booking}
            disabled={!selected}
          />
          {!isReschedule && !slotsLoading && slots.length === 0 ? (
            <Button
              label={waitlistBusy ? 'Se salvează…' : 'Anunță-mă dacă se eliberează'}
              variant="secondary"
              icon="notifications-outline"
              loading={waitlistBusy}
              onPress={() => void handleWaitlist()}
            />
          ) : null}
        </>
      }
    >
      <View style={[styles.summary, { backgroundColor: t.colors.accentSoft }]}>
        <View style={[styles.summaryIcon, { backgroundColor: t.colors.accent }]}>
          <Ionicons name="storefront" size={20} color={t.colors.onAccent} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.summaryName, { color: t.colors.accentSoftText }]}>
            {business.name}
          </Text>
          <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
            {selectedService
              ? `${selectedService.name} · ${formatDuration(selectedService.duration_minutes)} · ${formatRon(selectedService.price)}`
              : `Ședință de ${durationMinutes} min · ${business.timezone}`}
          </Text>
        </View>
        <Badge tone="accent">{slots.length} libere</Badge>
      </View>

      <LocationCard location={locationFromBusiness(business)} />

      {!isReschedule && (business.deposit_ron ?? 0) > 0 ? (
        <Callout tone="info" title="Avans">
          La rezervare se cere un avans de {formatLei(business.deposit_ron)}.
        </Callout>
      ) : null}

      {(business.loyalty_every ?? 0) >= 2 ? (
        <Callout tone="accent" title="Loialitate">
          A {business.loyalty_every}-a ședință confirmată e gratuită.
        </Callout>
      ) : null}

      {staffList.length > 1 ? (
        <>
          <SectionTitle>Specialist</SectionTitle>
          <View style={styles.serviceList}>
            {staffList.map((s) => {
              const on = s.id === staffId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setStaffId(s.id);
                    setSelected(null);
                  }}
                  style={({ pressed }) => [
                    styles.serviceChip,
                    {
                      backgroundColor: on ? t.colors.accent : t.colors.surface,
                      borderColor: on ? t.colors.accent : t.colors.borderStrong,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.serviceName,
                      { color: on ? t.colors.onAccent : t.colors.text },
                    ]}
                  >
                    {s.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {services.length > 0 ? (
        <>
          <SectionTitle>Serviciu</SectionTitle>
          <View style={styles.serviceList}>
            {services.map((s) => {
              const on = s.id === serviceId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setServiceId(s.id);
                    setSelected(null);
                  }}
                  style={({ pressed }) => [
                    styles.serviceChip,
                    {
                      backgroundColor: on ? t.colors.accent : t.colors.surface,
                      borderColor: on ? t.colors.accent : t.colors.borderStrong,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.serviceName,
                      { color: on ? t.colors.onAccent : t.colors.text },
                    ]}
                  >
                    {s.name}
                  </Text>
                  <Text
                    style={[
                      styles.serviceMeta,
                      { color: on ? t.colors.onAccent : t.colors.textMuted },
                    ]}
                  >
                    {formatDuration(s.duration_minutes)} · {formatRon(s.price)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <DatePickerField
        label="Data programării"
        value={dateLocal}
        onChange={(ymd) => {
          setDateLocal(ymd);
          setSelected(null);
        }}
        minimumDate={minDate}
        maximumDate={maxDate}
      />

      <SectionTitle>Ora — doar din sloturile libere</SectionTitle>

      <View
        style={[
          styles.timeLocked,
          { backgroundColor: t.colors.surface, borderColor: t.colors.borderStrong },
        ]}
      >
        <View style={styles.timeLockedLeft}>
          <Ionicons name="time-outline" size={16} color={t.colors.textMuted} />
          <Text style={[styles.timeLockedLabel, { color: t.colors.textMuted }]}>
            Ora aleasă
          </Text>
        </View>
        <Text
          style={[
            styles.timeLockedValue,
            { color: selected ? t.colors.text : t.colors.textFaint },
          ]}
        >
          {selected ? selected.labelLocal : '—'}
        </Text>
      </View>

      {slotsLoading ? (
        <View style={styles.slotsLoading}>
          <ActivityIndicator color={t.colors.accent} />
        </View>
      ) : (
        <SlotPicker
          slots={slots}
          selectedStartUtc={selected?.startUtc}
          onSelect={setSelected}
          emptyLabel={
            (business.blocked_dates ?? []).includes(dateLocal)
              ? 'Această zi este blocată (concediu / sărbătoare).'
              : `Nu există sloturi libere pe ${dateLocal}. Alege altă dată (preaviz minim ${Math.max(1, Math.ceil((business.min_notice_minutes ?? 0) / 60))}h).`
          }
        />
      )}

      <Text style={[styles.note, { color: t.colors.textFaint }]}>
        {isReschedule
          ? 'Alege un slot nou. Statusul programării rămâne neschimbat.'
          : 'Ora nu se poate modifica manual — alege un slot liber. După trimitere, cererea apare ca „în așteptare” până la confirmare.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryName: { fontSize: fontSize.md, fontWeight: '800' },
  summaryMeta: { fontSize: fontSize.sm, marginTop: 1 },
  serviceList: { gap: spacing.sm },
  serviceChip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  serviceName: { fontSize: fontSize.md, fontWeight: '700' },
  serviceMeta: { fontSize: fontSize.sm },
  timeLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 2,
  },
  timeLockedLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeLockedLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  timeLockedValue: { fontSize: fontSize.xl, fontWeight: '800' },
  slotsLoading: { paddingVertical: spacing['2xl'], alignItems: 'center' },
  note: { fontSize: fontSize.xs, lineHeight: 17 },
});
