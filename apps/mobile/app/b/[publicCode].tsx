import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';

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
import { setPendingAuthRedirect } from '@/lib/auth-redirect';
import { setAppMode } from '@/lib/appMode';
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
import { locationFromBusiness } from '@/lib/location';
import { useBack } from '@/lib/nav';
import { markWaitlistBooked } from '@/lib/notify-client';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { generateFreeSlots } from '@/lib/slots';
import { localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';

/** Public HTTPS booking page: /b/{publicCode} — works in browser without installing the app. */
export default function PublicBookScreen() {
  const t = useTheme();
  const goBack = useBack();
  const { publicCode } = useLocalSearchParams<{ publicCode: string }>();
  const code = String(publicCode ?? '').trim();
  const [session, setSession] = useState<Session | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [rating, setRating] = useState<{ avg_rating: number | null; review_count: number } | null>(
    null
  );
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      setError(null);
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

      const { data: rate } = await supabase.rpc('business_rating', { p_business_id: biz.id });
      const row = Array.isArray(rate) ? rate[0] : rate;
      setRating(
        row
          ? {
              avg_rating: row.avg_rating ?? null,
              review_count: Number(row.review_count ?? 0),
            }
          : null
      );
      setLoading(false);
    })();
  }, [code]);

  const loadSlots = useCallback(async () => {
    if (!business) return;
    setSlotsLoading(true);
    setSelected(null);
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
    const { busy, error: err } = await listBusyRanges({
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
    const hours = staffSchedule(selectedStaff, business);
    setSlots(
      generateFreeSlots({
        dateLocal,
        timezone: business.timezone,
        sessionDurationMinutes: durationMinutes,
        workingHours: hours.workingHours,
        breakHours: hours.breakHours,
        busy,
        bufferMinutes: business.buffer_minutes ?? 0,
        blockedDates: business.blocked_dates ?? [],
        notBeforeUtc: notBeforeUtc(business),
      })
    );
    setSlotsLoading(false);
  }, [business, dateLocal, durationMinutes, staffId, selectedStaff]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  function goLogin() {
    setPendingAuthRedirect(`/b/${code}`);
    void setAppMode('client');
    router.push('/(auth)/client');
  }

  async function handleBook() {
    if (!session) {
      goLogin();
      return;
    }
    if (!business || !selected) {
      setError('Alege un slot.');
      return;
    }
    setBooking(true);
    setError(null);
    setMessage(null);
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
      await markWaitlistBooked({
        businessId: business.id,
        clientUserId: session.user.id,
        desiredDate: dateLocal,
      });
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
  }

  async function handleWaitlist() {
    if (!session) {
      goLogin();
      return;
    }
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
    return <SkeletonScreen title="Programare" onBack={goBack} blocks={5} label="Se încarcă agenda…" />;
  }

  if (!business) {
    return (
      <Screen title="Programare" onBack={goBack}>
        <ErrorState
          title="Nu am găsit business-ul"
          description={error ?? 'Cod invalid.'}
          action={
            <Button label="Înapoi la cont" onPress={goBack} icon="arrow-back-outline" />
          }
        />
      </Screen>
    );
  }

  const dayBlocked = (business.blocked_dates ?? []).includes(dateLocal);
  const noSlots = !slotsLoading && slots.length === 0;

  return (
    <Screen
      title={business.name}
      subtitle="Programare online"
      onBack={goBack}
      footer={
        <>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {message ? <Callout tone="success">{message}</Callout> : null}
          {!session ? (
            <Button
              label="Intră în cont ca să rezervi"
              icon="log-in-outline"
              onPress={goLogin}
            />
          ) : (
            <>
              <Button
                label={booking ? 'Se trimite…' : 'Trimite cererea'}
                icon="paper-plane-outline"
                onPress={() => void handleBook()}
                loading={booking}
                disabled={!selected}
              />
              {noSlots && !dayBlocked ? (
                <Button
                  label={waitlistBusy ? 'Se salvează…' : 'Anunță-mă dacă se eliberează'}
                  variant="secondary"
                  icon="notifications-outline"
                  loading={waitlistBusy}
                  onPress={() => void handleWaitlist()}
                />
              ) : null}
            </>
          )}
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
          {rating && rating.review_count > 0 ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
              {rating.avg_rating} ★ · {rating.review_count} recenzii
            </Text>
          ) : null}
          <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
            {selectedService
              ? `${selectedService.name} · ${formatDuration(selectedService.duration_minutes)} · ${formatRon(selectedService.price)}`
              : `${durationMinutes} min · ${business.timezone}`}
          </Text>
        </View>
        <Badge tone="accent">{slots.length} libere</Badge>
      </View>

      <LocationCard location={locationFromBusiness(business)} />

      {(business.deposit_ron ?? 0) > 0 ? (
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
                  style={[
                    styles.serviceChip,
                    {
                      backgroundColor: on ? t.colors.accent : t.colors.surface,
                      borderColor: on ? t.colors.accent : t.colors.borderStrong,
                    },
                  ]}
                >
                  <Text style={[styles.serviceName, { color: on ? t.colors.onAccent : t.colors.text }]}>
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
                  style={[
                    styles.serviceChip,
                    {
                      backgroundColor: on ? t.colors.accent : t.colors.surface,
                      borderColor: on ? t.colors.accent : t.colors.borderStrong,
                    },
                  ]}
                >
                  <Text style={[styles.serviceName, { color: on ? t.colors.onAccent : t.colors.text }]}>
                    {s.name}
                  </Text>
                  <Text style={[styles.serviceMeta, { color: on ? t.colors.onAccent : t.colors.textMuted }]}>
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
        onChange={setDateLocal}
        minimumDate={minDate}
        maximumDate={maxDate}
      />

      <SectionTitle>Ore libere</SectionTitle>
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
            dayBlocked
              ? 'Această zi este blocată (concediu / sărbătoare).'
              : `Nu există sloturi libere pe ${dateLocal}. Alege altă dată (preaviz minim ${Math.max(1, Math.ceil((business.min_notice_minutes ?? 0) / 60))}h).`
          }
        />
      )}
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
  slotsLoading: { paddingVertical: spacing['2xl'], alignItems: 'center' },
});
