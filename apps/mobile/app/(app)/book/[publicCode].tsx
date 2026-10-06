import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import { LocationCard } from '@/components/LocationCard';
import { SlotPicker } from '@/components/SlotPicker';
import { StaffBadge } from '@/components/StaffBadge';
import { BusinessVisitCard } from '@/components/BusinessVisitCard';
import { businessToVisitCardProps } from '@/lib/visitCard';
import {
  Badge,
  Button,
  Callout,
  ErrorState,
  Screen,
  SectionTitle,
  Segmented,
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
import { createAppointmentIfFree, createRecurringAppointments, listBusyRanges, notifyAfterBooking } from '@/lib/bookingRpc';
import { clampRepeatCount } from '@/lib/recurringRules';
import {
  WAITLIST_JOIN_BODY,
  WAITLIST_JOIN_CTA,
  WAITLIST_JOIN_TITLE,
  WAITLIST_ON_LIST,
} from '@/lib/waitlistCopy';
import { formatDuration, formatLei, formatRon } from '@/lib/format';
import { useBack } from '@/lib/nav';
import { locationFromBusiness, formatAddress } from '@/lib/location';
import { markWaitlistBooked, invokePendingPush } from '@/lib/notify-client';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { generateFreeSlots } from '@/lib/slots';
import { localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';
import {
  getFavoriteIds,
  isFavoriteSync,
  subscribeFavorites,
  toggleFavorite,
} from '@/lib/favorites';

type WizardStep = 'staff' | 'service' | 'date' | 'slot' | 'confirm';

type ReviewSnippet = {
  rating: number;
  comment: string;
  created_at: string;
};

const STEP_LABELS: Record<WizardStep, string> = {
  staff: 'Specialist',
  service: 'Serviciu',
  date: 'Dată',
  slot: 'Oră',
  confirm: 'Confirmă',
};

function buildSteps(hasStaffChoice: boolean, hasServices: boolean): WizardStep[] {
  const steps: WizardStep[] = [];
  if (hasStaffChoice) steps.push('staff');
  if (hasServices) steps.push('service');
  steps.push('date', 'slot', 'confirm');
  return steps;
}

export default function BookScreen() {
  const t = useTheme();
  const router = useRouter();
  const { publicCode, rescheduleId, serviceId: serviceIdParam, staffId: staffIdParam } =
    useLocalSearchParams<{
      publicCode: string;
      rescheduleId?: string;
      serviceId?: string;
      staffId?: string;
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
  const [onWaitlist, setOnWaitlist] = useState(false);
  const [ownBusinessBlock, setOwnBusinessBlock] = useState(false);
  const [bookAsClientHint, setBookAsClientHint] = useState(false);
  const [existingAptId, setExistingAptId] = useState<string | null>(null);
  const [rating, setRating] = useState<{ avg: number | null; count: number } | null>(null);
  const [reviews, setReviews] = useState<ReviewSnippet[]>([]);
  const [favorited, setFavorited] = useState(false);
  const [step, setStep] = useState<WizardStep>('service');
  const [stepsReady, setStepsReady] = useState(false);
  const [repeatCount, setRepeatCount] = useState(1);

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

  const hasStaffChoice = staffList.length > 1;
  const hasServices = services.length > 0;
  const steps = useMemo(
    () => buildSteps(hasStaffChoice, hasServices),
    [hasStaffChoice, hasServices]
  );
  const stepIndex = Math.max(0, steps.indexOf(step));

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
    void getFavoriteIds().then(() => {
      if (business?.id) setFavorited(isFavoriteSync(business.id));
    });
    return subscribeFavorites((ids) => {
      if (business?.id) setFavorited(ids.includes(business.id));
    });
  }, [business?.id]);

  useEffect(() => {
    (async () => {
      setError(null);
      setStepsReady(false);
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
      setOwnBusinessBlock(false);
      setBookAsClientHint(false);
      setExistingAptId(null);
      setFavorited(isFavoriteSync(biz.id));

      const { data: rate } = await supabase.rpc('business_rating', {
        p_business_id: biz.id,
      });
      if (rate) {
        const row = Array.isArray(rate) ? rate[0] : rate;
        if (row) {
          setRating({
            avg: row.avg_rating != null ? Number(row.avg_rating) : null,
            count: Number(row.review_count ?? 0) || 0,
          });
        }
      }

      const { data: revRows } = await supabase.rpc('list_public_reviews', {
        p_business_id: biz.id,
        p_limit: 3,
      });
      if (Array.isArray(revRows)) {
        setReviews(
          revRows
            .map((r: Record<string, unknown>) => ({
              rating: typeof r.rating === 'number' ? r.rating : Number(r.rating) || 0,
              comment: typeof r.comment === 'string' ? r.comment : '',
              created_at: typeof r.created_at === 'string' ? r.created_at : '',
            }))
            .filter((r: ReviewSnippet) => r.rating >= 1)
        );
      } else {
        // Fallback: best-effort direct select (poate fi blocat de RLS)
        const { data: direct } = await supabase
          .from('reviews')
          .select('rating, comment, created_at')
          .eq('business_id', biz.id)
          .order('created_at', { ascending: false })
          .limit(3);
        if (direct) {
          setReviews(
            (direct as ReviewSnippet[]).filter((r) => typeof r.rating === 'number')
          );
        }
      }

      const {
        data: { user: viewer },
      } = await supabase.auth.getUser();
      if (viewer) {
        if (biz.owner_user_id === viewer.id) {
          setOwnBusinessBlock(true);
          setLoading(false);
          return;
        }
        const { data: ownedBiz } = await supabase
          .from('business_profiles')
          .select('id')
          .eq('owner_user_id', viewer.id)
          .maybeSingle();
        if (ownedBiz) setBookAsClientHint(true);

        if (!rescheduleId) {
          const { data: upcoming } = await supabase
            .from('appointments')
            .select('id')
            .eq('business_id', biz.id)
            .eq('client_user_id', viewer.id)
            .in('status', ['pending', 'approved'])
            .gte('start_at', new Date().toISOString())
            .order('start_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (upcoming?.id) setExistingAptId(upcoming.id as string);
        }
      }

      const { data: svcRows } = await supabase
        .from('services')
        .select('*')
        .eq('business_id', biz.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      const list = (svcRows ?? []) as Service[];
      setServices(list);
      const fromQsSvc =
        typeof serviceIdParam === 'string'
          ? serviceIdParam
          : Array.isArray(serviceIdParam)
            ? serviceIdParam[0]
            : null;
      if (list.length > 0) {
        setServiceId(fromQsSvc && list.some((s) => s.id === fromQsSvc) ? fromQsSvc : list[0].id);
      }

      const { data: staffRows } = await supabase
        .from('staff')
        .select('*')
        .eq('business_id', biz.id)
        .eq('active', true)
        .order('sort_order', { ascending: true });
      const team = (staffRows ?? []) as Staff[];
      setStaffList(team);
      const fromQsStaff =
        typeof staffIdParam === 'string'
          ? staffIdParam
          : Array.isArray(staffIdParam)
            ? staffIdParam[0]
            : null;
      if (team.length > 0) {
        setStaffId(fromQsStaff && team.some((s) => s.id === fromQsStaff) ? fromQsStaff : team[0].id);
      }

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

      const built = buildSteps(team.length > 1, list.length > 0);
      // Rebook 1-tap / reschedule: sari la dată dacă specialist+serviciu sunt deja alese
      const prefilled =
        Boolean(fromQsSvc || fromQsStaff || rescheduleId) &&
        (list.length === 0 || Boolean(fromQsSvc || rescheduleId));
      setStep(prefilled || isReschedule ? 'date' : built[0] ?? 'date');
      setStepsReady(true);
      setLoading(false);
    })();
  }, [publicCode, rescheduleId, serviceIdParam, staffIdParam, isReschedule]);

  const loadSlots = useCallback(async () => {
    if (!business) return;
    setSlotsLoading(true);
    setSelected(null);
    setError(null);
    setMessage(null);
    setOnWaitlist(false);

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
    if (step === 'slot' || step === 'confirm' || step === 'date') {
      void loadSlots();
    }
  }, [loadSlots, step]);

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

    if (!isReschedule && repeatCount > 1) {
      const { appointments: series, error: err } = await createRecurringAppointments({
        businessId: business.id,
        startAt: selected.startUtc,
        endAt: selected.endUtc,
        serviceId,
        staffId,
        repeatCount,
      });
      setBooking(false);
      if (err) {
        setError(mapBookingRpcError(err));
        await loadSlots();
        return;
      }
      if (series[0]) {
        const notify = await notifyAfterBooking(series[0]);
        if (!notify.ok) {
          console.warn('notify after recurring failed', notify.error);
        }
      }
      setSelected(null);
      await loadSlots();
      const first = series[0];
      setMessage(
        first?.status === 'approved'
          ? `Serie săptămânală × ${series.length} confirmată automat.`
          : `Serie săptămânală × ${series.length} trimisă. Așteaptă confirmarea.`
      );
      setTimeout(() => router.replace('/(app)/my-appointments'), 600);
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
    setOnWaitlist(true);
    setMessage(WAITLIST_ON_LIST);
  }

  function goNext() {
    const i = steps.indexOf(step);
    if (i < 0 || i >= steps.length - 1) return;
    const next = steps[i + 1];
    if (step === 'slot' && !selected) {
      setError('Alege un slot liber.');
      return;
    }
    setError(null);
    setStep(next);
  }

  function goPrev() {
    const i = steps.indexOf(step);
    if (i <= 0) {
      goBack();
      return;
    }
    setError(null);
    setStep(steps[i - 1]);
  }

  if (loading || !stepsReady) {
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

  if (ownBusinessBlock) {
    return (
      <Screen title="Rezervare" onBack={goBack}>
        <ErrorState
          title="Propriul tău business"
          description="Nu te poți programa la business-ul tău prin scanare. Folosește Calendarul pentru programări interne."
          action={
            <Button
              label="Deschide calendarul"
              icon="calendar-outline"
              onPress={() => router.replace('/(app)/business/calendar' as never)}
            />
          }
        />
      </Screen>
    );
  }

  const code = String(publicCode ?? '').trim();
  const addr = formatAddress(locationFromBusiness(business));
  const canAdvance =
    step === 'staff'
      ? Boolean(staffId)
      : step === 'service'
        ? Boolean(serviceId) || services.length === 0
        : step === 'date'
          ? Boolean(dateLocal)
          : step === 'slot'
            ? Boolean(selected)
            : Boolean(selected);

  const footer =
    step === 'confirm' ? (
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
          <>
            <Callout tone="accent" title={WAITLIST_JOIN_TITLE}>
              {onWaitlist ? WAITLIST_ON_LIST : WAITLIST_JOIN_BODY}
            </Callout>
            {!onWaitlist ? (
              <Button
                label={waitlistBusy ? 'Se salvează…' : WAITLIST_JOIN_CTA}
                variant="secondary"
                icon="notifications-outline"
                loading={waitlistBusy}
                onPress={() => void handleWaitlist()}
              />
            ) : null}
          </>
        ) : null}
      </>
    ) : step === 'slot' && !slotsLoading && slots.length === 0 && !isReschedule ? (
      <>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Callout tone="accent" title={WAITLIST_JOIN_TITLE}>
          {onWaitlist ? WAITLIST_ON_LIST : WAITLIST_JOIN_BODY}
        </Callout>
        {!onWaitlist ? (
          <Button
            label={waitlistBusy ? 'Se salvează…' : WAITLIST_JOIN_CTA}
            variant="secondary"
            icon="notifications-outline"
            loading={waitlistBusy}
            onPress={() => void handleWaitlist()}
          />
        ) : null}
        <Button label="Alege altă dată" variant="secondary" onPress={() => setStep('date')} />
      </>
    ) : (
      <>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <Button
          label={step === 'slot' ? 'Continuă la confirmare' : 'Continuă'}
          icon="arrow-forward"
          onPress={goNext}
          disabled={!canAdvance}
        />
      </>
    );

  return (
    <Screen
      title={isReschedule ? 'Reprogramare' : business.name}
      subtitle={`${STEP_LABELS[step]} · pasul ${stepIndex + 1}/${steps.length}`}
      onBack={goPrev}
      footer={footer}
    >
      <SalonProfileHeader
        business={business}
        address={addr}
        rating={rating}
        reviews={reviews}
        favorited={favorited}
        onToggleFavorite={() => {
          void toggleFavorite(business.id).then(setFavorited);
        }}
      />

      <BusinessVisitCard
        {...businessToVisitCardProps(
          {
            name: business.name,
            public_code: business.public_code,
            working_hours: business.working_hours,
            county: business.county ?? null,
            city: business.city ?? null,
            address: business.address ?? null,
            maps_url: business.maps_url ?? null,
            latitude: business.latitude ?? null,
            longitude: business.longitude ?? null,
          },
          null
        )}
        showPhoneWarning={false}
        qrSize={80}
        logoUrl={business.logo_url}
        videoUrl={business.promo_video_url}
        publicMode
      />

      <View style={styles.stepper}>
        {steps.map((s, i) => {
          const active = s === step;
          const done = i < stepIndex;
          return (
            <Pressable
              key={s}
              onPress={() => {
                if (i <= stepIndex) setStep(s);
              }}
              style={[
                styles.stepPill,
                {
                  backgroundColor: active
                    ? t.colors.accent
                    : done
                      ? t.colors.accentSoft
                      : t.colors.surfaceMuted,
                  borderColor: active ? t.colors.accent : t.colors.border,
                },
              ]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={{
                  fontSize: fontSize.xs,
                  fontWeight: '700',
                  color: active
                    ? t.colors.onAccent
                    : done
                      ? t.colors.accentSoftText
                      : t.colors.textMuted,
                }}
                numberOfLines={1}
              >
                {i + 1}. {STEP_LABELS[s]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {bookAsClientHint && !isReschedule ? (
        <Callout tone="accent" title="Rezervă ca client">
          Ai un cont business, dar aici te programezi ca client la {business.name}.
        </Callout>
      ) : null}

      {existingAptId && !isReschedule && stepIndex === 0 ? (
        <>
          <Callout tone="info" title="Ai deja o programare aici">
            Poți muta ora existentă fără să creezi o cerere nouă.
          </Callout>
          <Button
            label="Reprogramează"
            variant="secondary"
            icon="calendar-outline"
            onPress={() =>
              router.replace(`/(app)/book/${code}?rescheduleId=${existingAptId}` as never)
            }
          />
        </>
      ) : null}

      {!isReschedule && (business.deposit_ron ?? 0) > 0 && step === 'confirm' ? (
        <Callout tone="info" title="Avans">
          La rezervare se cere un avans de {formatLei(business.deposit_ron)}.
        </Callout>
      ) : null}

      {(business.loyalty_every ?? 0) >= 2 && step === 'confirm' ? (
        <Callout tone="accent" title="Loialitate">
          A {business.loyalty_every}-a ședință confirmată e gratuită.
        </Callout>
      ) : null}

      {step === 'staff' ? (
        <>
          <SectionTitle>Alege specialistul</SectionTitle>
          <View style={styles.staffGrid}>
            {staffList.map((s) => {
              const on = s.id === staffId;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setStaffId(s.id);
                    setSelected(null);
                  }}
                  style={({ pressed }) => [styles.staffCell, { opacity: pressed ? 0.85 : 1 }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Specialist ${s.name}`}
                >
                  <StaffBadge
                    name={s.name}
                    photoUrl={s.photo_url}
                    color={s.color}
                    size={64}
                    selected={on}
                  />
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {step === 'service' ? (
        <>
          <SectionTitle>Alege serviciul</SectionTitle>
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
                    style={[styles.serviceName, { color: on ? t.colors.onAccent : t.colors.text }]}
                  >
                    {s.name}
                  </Text>
                  {s.description ? (
                    <Text
                      style={[
                        styles.serviceDesc,
                        { color: on ? t.colors.onAccent : t.colors.textMuted },
                      ]}
                      numberOfLines={3}
                    >
                      {s.description}
                    </Text>
                  ) : null}
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

      {step === 'date' ? (
        <>
          <SectionTitle>Alege data</SectionTitle>
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
          {selectedStaff ? (
            <Text style={[styles.note, { color: t.colors.textMuted }]}>
              Specialist: {selectedStaff.name}
              {selectedService ? ` · ${selectedService.name}` : ''}
            </Text>
          ) : null}
        </>
      ) : null}

      {step === 'slot' ? (
        <>
          <SectionTitle>Alege ora</SectionTitle>
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
            <Badge tone="accent">{slots.length} libere</Badge>
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
        </>
      ) : null}

      {step === 'confirm' ? (
        <>
          <SectionTitle>Confirmă rezervarea</SectionTitle>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <ConfirmLine label="Salon" value={business.name} />
            {selectedStaff ? <ConfirmLine label="Specialist" value={selectedStaff.name} /> : null}
            {selectedService ? (
              <ConfirmLine
                label="Serviciu"
                value={`${selectedService.name} · ${formatDuration(selectedService.duration_minutes)} · ${formatRon(selectedService.price)}`}
              />
            ) : (
              <ConfirmLine label="Durată" value={`${durationMinutes} min`} />
            )}
            <ConfirmLine label="Data" value={dateLocal} />
            <ConfirmLine label="Ora" value={selected?.labelLocal ?? '—'} />
            {!isReschedule ? (
              <ConfirmLine
                label="Repetă"
                value={repeatCount === 1 ? 'O singură dată' : `Săptămânal × ${repeatCount}`}
              />
            ) : null}
          </View>
          {!isReschedule ? (
            <Segmented
              value={String(repeatCount)}
              onChange={(v) => setRepeatCount(clampRepeatCount(Number(v)))}
              options={[
                { value: '1', label: 'O dată' },
                { value: '2', label: '×2 săpt.' },
                { value: '3', label: '×3 săpt.' },
                { value: '4', label: '×4 săpt.' },
              ]}
            />
          ) : null}
          <LocationCard location={locationFromBusiness(business)} />
          <Text style={[styles.note, { color: t.colors.textFaint }]}>
            {isReschedule
              ? 'Alege un slot nou. Statusul programării rămâne neschimbat.'
              : 'După trimitere, cererea apare ca „în așteptare” până la confirmare (sau e aprobată automat).'}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}

function ConfirmLine({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.confirmLine}>
      <Text style={[styles.confirmLabel, { color: t.colors.textMuted }]}>{label}</Text>
      <Text style={[styles.confirmValue, { color: t.colors.text }]}>{value}</Text>
    </View>
  );
}

function SalonProfileHeader({
  business,
  address,
  rating,
  reviews,
  favorited,
  onToggleFavorite,
}: {
  business: BusinessProfile;
  address: string | null;
  rating: { avg: number | null; count: number } | null;
  reviews: ReviewSnippet[];
  favorited: boolean;
  onToggleFavorite: () => void;
}) {
  const t = useTheme();
  const [imgFailed, setImgFailed] = useState(false);
  const showLogo = Boolean(business.logo_url) && !imgFailed;

  return (
    <View
      style={[
        styles.profile,
        { backgroundColor: t.colors.accentSoft, borderColor: t.colors.border },
      ]}
    >
      <View style={styles.profileTop}>
        <View style={[styles.profileLogo, { backgroundColor: t.colors.surface }]}>
          {showLogo ? (
            <Image
              source={{ uri: business.logo_url as string }}
              style={styles.profileLogoImg}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <Ionicons name="storefront" size={28} color={t.colors.accent} />
          )}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.profileName, { color: t.colors.accentSoftText }]} numberOfLines={2}>
            {business.name}
          </Text>
          {address ? (
            <Text style={[styles.profileAddr, { color: t.colors.accentSoftText }]} numberOfLines={2}>
              {address}
            </Text>
          ) : null}
          {rating && rating.count > 0 && rating.avg != null ? (
            <Text style={[styles.profileRating, { color: t.colors.accentSoftText }]}>
              ★ {rating.avg.toFixed(1)} · {rating.count}{' '}
              {rating.count === 1 ? 'recenzie' : 'recenzii'}
            </Text>
          ) : (
            <Text style={[styles.profileRating, { color: t.colors.accentSoftText }]}>
              Fără recenzii încă
            </Text>
          )}
        </View>
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favorited ? 'Scoate din favorite' : 'Adaugă la favorite'}
          style={styles.heartBtn}
        >
          <Ionicons
            name={favorited ? 'heart' : 'heart-outline'}
            size={24}
            color={favorited ? t.colors.danger : t.colors.accentSoftText}
          />
        </Pressable>
      </View>
      {reviews.length > 0 ? (
        <View style={styles.reviewSnippets}>
          {reviews.slice(0, 2).map((r, i) => (
            <Text
              key={`${r.created_at}-${i}`}
              style={[styles.reviewLine, { color: t.colors.accentSoftText }]}
              numberOfLines={2}
            >
              {'★'.repeat(Math.min(5, Math.max(1, r.rating)))}
              {r.comment?.trim() ? ` — ${r.comment.trim()}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  profile: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  profileTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  profileLogo: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileLogoImg: { width: 56, height: 56, borderRadius: radius.md },
  profileName: { fontSize: fontSize.lg, fontWeight: '800' },
  profileAddr: { fontSize: fontSize.sm, marginTop: 2 },
  profileRating: { fontSize: fontSize.sm, fontWeight: '600', marginTop: 4 },
  heartBtn: { padding: 4 },
  reviewSnippets: { gap: 4, marginTop: 4 },
  reviewLine: { fontSize: fontSize.xs, lineHeight: 16 },
  stepper: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stepPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  serviceList: { gap: spacing.sm },
  staffGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-start',
  },
  staffCell: { width: '31%', alignItems: 'center' },
  serviceChip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  serviceName: { fontSize: fontSize.md, fontWeight: '700' },
  serviceDesc: { fontSize: fontSize.sm, opacity: 0.9 },
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
  timeLockedLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  timeLockedLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  timeLockedValue: { fontSize: fontSize.xl, fontWeight: '800' },
  slotsLoading: { paddingVertical: spacing['2xl'], alignItems: 'center' },
  note: { fontSize: fontSize.xs, lineHeight: 17 },
  confirmCard: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  confirmLine: { gap: 2 },
  confirmLabel: { fontSize: fontSize.xs, fontWeight: '600', textTransform: 'uppercase' },
  confirmValue: { fontSize: fontSize.md, fontWeight: '700' },
});
