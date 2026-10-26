import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import type { DateInputIssue } from '@/lib/dateInput';
import { LocationCard } from '@/components/LocationCard';
import { SlotPicker } from '@/components/SlotPicker';
import { StaffBadge } from '@/components/StaffBadge';
import { StaffPortfolio } from '@/components/StaffPortfolio';
import { SocialButtons } from '@/components/SocialButtons';
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
  canClientReschedule,
  firstBookableDateForStaff,
  mapBookingRpcError,
  maxBookingDate,
  notBeforeUtc,
  staffSchedule,
  toYmd,
} from '@/lib/bookingRules';
import {
  createAppointmentIfFree,
  createAppointmentMultiIfFree,
  createRecurringAppointments,
  createRecurringMultiAppointments,
  listBusyRanges,
  notifyAfterBooking,
} from '@/lib/bookingRpc';
import { comboTotals, toggleServiceId } from '@/lib/serviceCombo';
import {
  staffForServices,
  staffOffersService,
  staffServicesMap,
  type StaffServiceRow,
} from '@/lib/staffServices';
import { discountedPrice, isOffpeakStart } from '@/lib/offpeak';
import { parseTipInput, tipOptions } from '@/lib/tip';
import { normalizeRepeatSelection } from '@/lib/recurringRules';
import {
  waitlistJoinBody,
  waitlistJoinCta,
  waitlistJoinTitle,
  waitlistOnList,
} from '@/lib/waitlistCopy';
import { trKey, useT } from '@/lib/i18n';
import { formatDuration, formatLei, formatRon } from '@/lib/format';
import { useBack } from '@/lib/nav';
import { locationFromBusiness, formatAddress } from '@/lib/location';
import { markWaitlistBooked, invokePendingPush } from '@/lib/notify-client';
import { fireAndForget } from '@/lib/fireAndForget';
import { getCurrentUser } from '@/lib/currentUser';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { generateFreeSlots } from '@/lib/slots';
import { createRequestTracker } from '@/lib/latestRequest';
import { formatInTimeZone, localDayBoundsUtc } from '@/lib/timezone';
import { ANON_BUSINESS_COLUMNS } from '@/lib/publicPageMeta';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';
import {
  getFavoriteIds,
  isFavoriteSync,
  subscribeFavorites,
  toggleFavorite,
} from '@/lib/favorites';
import { useTransientMessage } from '@/lib/useTransientMessage';

type WizardStep = 'staff' | 'service' | 'date' | 'slot' | 'confirm';

type ReviewSnippet = {
  owner_reply?: string;
  rating: number;
  comment: string;
  created_at: string;
};

const STEP_LABELS: Record<WizardStep, 'book.stepStaff' | 'book.stepService' | 'book.stepDate' | 'book.stepTime' | 'book.stepConfirm'> = {
  staff: 'book.stepStaff',
  service: 'book.stepService',
  date: 'book.stepDate',
  slot: 'book.stepTime',
  confirm: 'book.stepConfirm',
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
  const tr = useT();
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
  // staff_services (v67): specialistul fără rânduri face tot.
  const [staffServices, setStaffServices] = useState<Record<string, string[]>>({});
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const serviceId = serviceIds[0] ?? null;
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  // Data tastată nu e (încă) utilizabilă: nu arătăm sloturile datei anterioare.
  const [dateIssue, setDateIssue] = useState<DateInputIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useTransientMessage();
  const [message, setMessage] = useTransientMessage();
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
  const [tipRon, setTipRon] = useState(0);
  const [tipCustom, setTipCustom] = useState('');

  const isReschedule = Boolean(rescheduleId);
  const combo = useMemo(() => comboTotals(services, serviceIds), [services, serviceIds]);
  const offpeakPct = business?.offpeak_discount_percent ?? 0;
  const selectedOffpeak =
    Boolean(selected) &&
    isOffpeakStart(
      selected!.startUtc,
      business?.timezone ?? 'Europe/Bucharest',
      business?.offpeak_start_hour ?? null,
      business?.offpeak_end_hour ?? null,
      offpeakPct
    );
  const selectedStaff = useMemo(
    () => staffList.find((s) => s.id === staffId) ?? null,
    [staffList, staffId]
  );
  // Doar serviciile pe care le face specialistul ales (pasul specialist vine înaintea serviciilor).
  const offeredServices = useMemo(
    () => (staffId ? services.filter((s) => staffOffersService(staffServices, staffId, s.id)) : services),
    [services, staffServices, staffId]
  );
  useEffect(() => {
    if (offeredServices.length === 0) return;
    setServiceIds((ids) => {
      const kept = ids.filter((id) => offeredServices.some((s) => s.id === id));
      if (kept.length === ids.length && kept.length > 0) return ids;
      return kept.length > 0 ? kept : [offeredServices[0].id];
    });
  }, [offeredServices]);

  const durationMinutes =
    combo.count > 0 ? combo.durationMinutes : business?.session_duration_minutes ?? 60;

  // Data implicită urmează specialistul și serviciile alese (nu primul din echipă).
  useEffect(() => {
    if (!business || !stepsReady) return;
    setDateLocal(
      firstBookableDateForStaff(business, selectedStaff ? [selectedStaff] : [], durationMinutes)
    );
  }, [business, stepsReady, selectedStaff, durationMinutes]);

  const hasStaffChoice = staffList.length > 1;
  const hasServices = services.length > 0;
  const steps = useMemo(
    () => buildSteps(hasStaffChoice, hasServices),
    [hasStaffChoice, hasServices]
  );
  const stepIndex = Math.max(0, steps.indexOf(step));

  const minDate = useMemo(() => {
    if (!business) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    // Azi pe calendarul firmei, la pranz local (evita decalajul de fus).
    const ymd = formatInTimeZone(new Date(), business.timezone, 'yyyy-MM-dd');
    return new Date(`${ymd}T12:00:00`);
  }, [business]);

  const maxDate = useMemo(
    () => (business ? maxBookingDate(business) : minDate),
    [business, minDate]
  );

  // Câmpul de dată se remontează la revenirea pe pas: pornește fără mesaj de dată invalidă.
  useEffect(() => {
    setDateIssue(null);
  }, [step]);

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
        setError(trKey('book.badCode'), { sticky: true });
        setLoading(false);
        return;
      }
      const { data, error: err } = await supabase
        .from('business_profiles')
        .select(ANON_BUSINESS_COLUMNS)
        .eq('public_code', code)
        .maybeSingle();
      if (err) {
        setError(err.message, { sticky: true });
        setLoading(false);
        return;
      }
      if (!data) {
        setError(trKey('book.notFound'), { sticky: true });
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

      // Utilizatorul vine din sesiunea locală (fără rețea); restul cererilor
      // depind doar de business, deci pleacă toate odată, nu una după alta.
      const viewer = await getCurrentUser();
      const [
        { data: rate },
        { data: revRows },
        { data: svcRows, error: svcErr },
        { data: staffRows, error: staffErr },
        ownedBizRes,
        upcomingRes,
        rescheduleAptRes,
      ] = await Promise.all([
        supabase.rpc('business_rating', { p_business_id: biz.id }),
        supabase.rpc('list_public_reviews', { p_business_id: biz.id, p_limit: 3 }),
        supabase
          .from('services')
          .select('*')
          .eq('business_id', biz.id)
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('staff')
          .select('*')
          .eq('business_id', biz.id)
          .eq('active', true)
          .order('sort_order', { ascending: true }),
        viewer
          ? supabase.from('business_profiles').select('id').eq('owner_user_id', viewer.id).maybeSingle()
          : null,
        viewer && !rescheduleId
          ? supabase
              .from('appointments')
              .select('id')
              .eq('business_id', biz.id)
              .eq('client_user_id', viewer.id)
              .in('status', ['pending', 'approved'])
              .gte('start_at', new Date().toISOString())
              .order('start_at', { ascending: true })
              .limit(1)
              .maybeSingle()
          : null,
        rescheduleId
          ? supabase
              .from('appointments')
              .select('service_id, service_ids, staff_id, status, start_at, client_user_id')
              .eq('id', String(rescheduleId))
              .maybeSingle()
          : null,
      ]);

      if (rate) {
        const row = Array.isArray(rate) ? rate[0] : rate;
        if (row) {
          setRating({
            avg: row.avg_rating != null ? Number(row.avg_rating) : null,
            count: Number(row.review_count ?? 0) || 0,
          });
        }
      }

      if (Array.isArray(revRows)) {
        setReviews(
          revRows
            .map((r: Record<string, unknown>) => ({
              rating: typeof r.rating === 'number' ? r.rating : Number(r.rating) || 0,
              comment: typeof r.comment === 'string' ? r.comment : '',
              created_at: typeof r.created_at === 'string' ? r.created_at : '',
              owner_reply: typeof r.owner_reply === 'string' ? r.owner_reply : '',
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

      // Proprietatea se afla din afacerea utilizatorului logat, nu din owner_user_id-ul afacerii
      // vizitate (anon nu are acces la coloana).
      const ownedBizId = (ownedBizRes?.data as { id?: string } | null)?.id ?? null;
      if (ownedBizId === biz.id) {
        setOwnBusinessBlock(true);
        setLoading(false);
        return;
      }
      if (ownedBizId) setBookAsClientHint(true);
      if (upcomingRes?.data?.id) setExistingAptId(upcomingRes.data.id as string);

      const list = (svcRows ?? []) as Service[];
      setServices(list);
      const fromQsSvc =
        typeof serviceIdParam === 'string'
          ? serviceIdParam
          : Array.isArray(serviceIdParam)
            ? serviceIdParam[0]
            : null;
      const firstServiceId =
        fromQsSvc && list.some((s) => s.id === fromQsSvc) ? fromQsSvc : list[0]?.id ?? null;
      if (firstServiceId) setServiceIds([firstServiceId]);

      const team = (staffRows ?? []) as Staff[];
      setStaffList(team);
      const fromQsStaff =
        typeof staffIdParam === 'string'
          ? staffIdParam
          : Array.isArray(staffIdParam)
            ? staffIdParam[0]
            : null;
      let offered: Record<string, string[]> = {};
      if (team.length > 0) {
        // Eroare de citire -> hartă goală = toți fac tot (comportamentul vechi).
        const { data: offeredRows } = await supabase
          .from('staff_services')
          .select('staff_id, service_id')
          .in('staff_id', team.map((m) => m.id));
        offered = staffServicesMap(offeredRows as StaffServiceRow[] | null);
        const pool = staffForServices(team, offered, firstServiceId ? [firstServiceId] : []);
        setStaffId(
          fromQsStaff && team.some((s) => s.id === fromQsStaff)
            ? fromQsStaff
            : (pool[0] ?? team[0]).id
        );
      }
      setStaffServices(offered);

      if (svcErr || staffErr) {
        setError(trKey('book.errLoadCatalog'), { sticky: true });
        setLoading(false);
        return;
      }

      if (rescheduleId) {
        const apt = rescheduleAptRes?.data;
        if (
          !apt ||
          apt.client_user_id !== viewer?.id ||
          !canClientReschedule(
            { status: apt.status as Appointment['status'], start_at: apt.start_at as string },
            biz
          )
        ) {
          setError(trKey('book.errCannotReschedule'), { sticky: true });
          setLoading(false);
          return;
        }
        const aptServiceIds = Array.isArray(apt?.service_ids)
          ? (apt.service_ids as string[]).filter((id) => list.some((s) => s.id === id))
          : apt?.service_id && list.some((s) => s.id === apt.service_id)
            ? [apt.service_id as string]
            : [];
        if (aptServiceIds.length > 0) {
          setServiceIds(aptServiceIds);
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

  // Doar ultima încărcare de sloturi are voie să scrie starea (tastarea datei cifră cu cifră
  // pornește câte o cerere pe dată intermediară; un răspuns vechi nu suprascrie unul nou).
  const slotsRequests = useRef(createRequestTracker()).current;

  const loadSlots = useCallback(async () => {
    if (!business) return;
    const req = slotsRequests.start();
    setSlotsLoading(true);
    setSelected(null);
    setError(null);
    setMessage(null);
    setOnWaitlist(false);

    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
    const [{ busy: rawBusy, error: err }, currentRes] = await Promise.all([
      listBusyRanges({
        businessId: business.id,
        fromIso: startUtc.toISOString(),
        toIso: endUtc.toISOString(),
        staffId,
      }),
      rescheduleId
        ? supabase
            .from('appointments')
            .select('start_at, end_at')
            .eq('id', String(rescheduleId))
            .maybeSingle()
        : null,
    ]);
    if (!slotsRequests.isCurrent(req)) return;

    if (err) {
      setError(err);
      setSlots([]);
      setSlotsLoading(false);
      return;
    }

    let busy = rawBusy;
    const current = currentRes?.data;
    if (current?.start_at) {
      busy = rawBusy.filter(
        (b) => !(b.startUtc === current.start_at && b.endUtc === current.end_at)
      );
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
  }, [business, dateLocal, durationMinutes, rescheduleId, staffId, selectedStaff, slotsRequests]);

  useEffect(() => {
    // Nu reincarca pe 'confirm': loadSlots() reseteaza ora aleasa si blocheaza trimiterea.
    if (step === 'slot' || step === 'date') {
      void loadSlots();
    }
  }, [loadSlots, step]);

  async function handleBook() {
    if (!business || !selected) {
      setError(trKey('book.pickSlot'));
      return;
    }
    if (services.length > 0 && serviceIds.length === 0) {
      setError(trKey('book.pickService'));
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
      // Push-ul către business pleacă în fundal; UI-ul nu-l așteaptă.
      void (async () => {
        const { data: moved } = await supabase
          .from('appointments')
          .select('id, business_id, status, client_email, client_phone, start_at')
          .eq('id', String(rescheduleId))
          .maybeSingle();
        if (moved?.id && moved?.business_id) {
          fireAndForget(
            invokePendingPush(
              {
                id: moved.id,
                business_id: moved.business_id,
                status: moved.status ?? 'approved',
                client_email: moved.client_email,
                client_phone: moved.client_phone,
                start_at: moved.start_at,
              },
              { reason: 'rescheduled' }
            ),
            'notify after reschedule failed'
          );
        }
      })().catch((e) => console.warn('notify after reschedule failed', e));
      setSelected(null);
      setMessage(trKey('book.moved'));
      setTimeout(() => router.replace('/(app)/my-appointments'), 800);
      return;
    }

    if (!isReschedule && repeatCount > 1) {
      const { appointments: series, error: err } =
        serviceIds.length > 1
          ? await createRecurringMultiAppointments({
              businessId: business.id,
              startAt: selected.startUtc,
              endAt: selected.endUtc,
              serviceIds,
              staffId,
              repeatCount,
            })
          : await createRecurringAppointments({
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
        fireAndForget(notifyAfterBooking(series[0]), 'notify after recurring failed');
      }
      setSelected(null);
      await loadSlots();
      const first = series[0];
      setMessage(
        first?.status === 'approved'
          ? trKey('book.seriesAuto', { n: series.length })
          : trKey('book.seriesPending', { n: series.length })
      );
      setTimeout(() => router.replace('/(app)/my-appointments'), 600);
      return;
    }

    const { appointment: created, error: err } =
      serviceIds.length > 1
        ? await createAppointmentMultiIfFree({
            businessId: business.id,
            startAt: selected.startUtc,
            endAt: selected.endUtc,
            serviceIds,
            staffId,
          })
        : await createAppointmentIfFree({
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
    let payError: string | null = null;
    if (appointment?.id) {
      fireAndForget(notifyAfterBooking(appointment), 'notify after book failed');
      const user = await getCurrentUser();
      if (user) {
        void markWaitlistBooked({
          businessId: business.id,
          clientUserId: user.id,
          desiredDate: dateLocal,
        }).catch((e) => console.warn('markWaitlistBooked failed', e));
      }
      if (appointment.payment_status === 'unpaid') {
        const pay = await startDepositCheckout(appointment.id, tipRon);
        if (!pay.ok) {
          payError = pay.error ?? 'checkout_failed';
        }
      }
    }

    setSelected(null);
    await loadSlots();
    if (appointment?.loyalty_redeemed) {
      setMessage(trKey('book.giftSent'));
    } else if (appointment?.status === 'approved') {
      setMessage(
        appointment.payment_status === 'unpaid'
          ? trKey('book.confirmedDeposit', { amount: formatLei(appointment.deposit_ron) })
          : trKey('book.confirmedAuto')
      );
    } else {
      setMessage(
        appointment?.payment_status === 'unpaid'
          ? trKey('book.sentDeposit', { amount: formatLei(appointment.deposit_ron) })
          : trKey('book.sentPending')
      );
    }
    if (payError === 'stripe_not_configured') {
      // Programarea ramane creata; plata online nu e activata inca.
      setMessage(mapPayError(payError));
    } else if (payError) {
      setError(mapPayError(payError));
    }
    if (appointment?.id) {
      setTimeout(() => router.replace('/(app)/my-appointments'), payError ? 6000 : 600);
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
    setMessage(waitlistOnList());
  }

  function goNext() {
    const i = steps.indexOf(step);
    if (i < 0 || i >= steps.length - 1) return;
    const next = steps[i + 1];
    if (step === 'slot' && !selected) {
      setError(trKey('book.pickFreeSlot'));
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

  if (!stepsReady && error && !loading) {
    return (
      <Screen title={tr('book.title')} onBack={goBack}>
        <ErrorState
          title={tr('book.loadFail')}
          description={error}
          action={<Button label={tr('common.back')} variant="secondary" onPress={goBack} />}
        />
      </Screen>
    );
  }

  // Proprietarul își vede propria firmă: încărcarea se oprește înainte de pași (stepsReady rămâne false).
  if (ownBusinessBlock) {
    return (
      <Screen title={tr('book.title')} onBack={goBack}>
        <ErrorState
          title={tr('book.ownBiz')}
          description={tr('book.ownBizDesc')}
          action={
            <Button
              label={tr('book.openCalendar')}
              icon="calendar-outline"
              onPress={() => router.replace('/(app)/business/calendar' as never)}
            />
          }
        />
      </Screen>
    );
  }

  if (loading || !stepsReady) {
    return (
      <SkeletonScreen title={tr('book.title')} onBack={goBack} blocks={5} label={tr('book.loadingAgenda')} />
    );
  }

  if (!business) {
    return (
      <Screen title={tr('book.title')} onBack={goBack}>
        <ErrorState
          title={tr('book.loadFail')}
          description={error ?? tr('auth.cbUnknownError')}
          action={<Button label={tr('common.back')} variant="secondary" onPress={goBack} />}
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
        ? serviceIds.length > 0 || services.length === 0
        : step === 'date'
          ? Boolean(dateLocal) && !dateIssue
          : step === 'slot'
            ? Boolean(selected)
            : Boolean(selected);

  const footer =
    step === 'confirm' ? (
      <>
        {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
        {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}
        <Button
          label={
            booking
              ? tr('common.sending')
              : isReschedule
                ? tr('book.moveBooking')
                : tr('book.sendRequest')
          }
          icon="paper-plane-outline"
          onPress={handleBook}
          loading={booking}
          disabled={!selected}
        />
        {!isReschedule && !slotsLoading && slots.length === 0 ? (
          <>
            <Callout tone="accent" title={waitlistJoinTitle()}>
              {onWaitlist ? waitlistOnList() : waitlistJoinBody()}
            </Callout>
            {!onWaitlist ? (
              <Button
                label={waitlistBusy ? tr('book.saving') : waitlistJoinCta()}
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
        {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
        <Callout tone="accent" title={waitlistJoinTitle()}>
          {onWaitlist ? waitlistOnList() : waitlistJoinBody()}
        </Callout>
        {!onWaitlist ? (
          <Button
            label={waitlistBusy ? tr('book.saving') : waitlistJoinCta()}
            variant="secondary"
            icon="notifications-outline"
            loading={waitlistBusy}
            onPress={() => void handleWaitlist()}
          />
        ) : null}
        <Button label={tr('book.pickOtherDate')} variant="secondary" onPress={() => setStep('date')} />
      </>
    ) : (
      <>
        {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
        <Button
          label={step === 'slot' ? tr('book.continueConfirm') : tr('book.continue')}
          icon="arrow-forward"
          onPress={goNext}
          disabled={!canAdvance}
        />
      </>
    );

  return (
    <Screen
      title={isReschedule ? tr('book.rescheduleTitle') : business.name}
      subtitle={tr('book.stepOf', { label: tr(STEP_LABELS[step]), i: stepIndex + 1, n: steps.length })}
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
        publicCode={code}
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
        rating={rating}
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
                {i + 1}. {tr(STEP_LABELS[s])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {bookAsClientHint && !isReschedule ? (
        <Callout tone="accent" title={tr('home.cardBookAsClient')}>
          {tr('book.asClientDesc', { name: business.name })}
        </Callout>
      ) : null}

      {existingAptId && !isReschedule && stepIndex === 0 ? (
        <>
          <Callout tone="info" title={tr('book.hasBooking')}>
            {tr('book.hasBookingDesc')}
          </Callout>
          <Button
            label={tr('appt.reschedule')}
            variant="secondary"
            icon="calendar-outline"
            onPress={() =>
              router.replace(`/(app)/book/${code}?rescheduleId=${existingAptId}` as never)
            }
          />
        </>
      ) : null}

      {!isReschedule && (business.deposit_ron ?? 0) > 0 && step === 'confirm' ? (
        <Callout tone="info" title={tr('book.deposit')}>
          {tr('book.depositDesc', { amount: formatLei(business.deposit_ron) })}
        </Callout>
      ) : null}

      {!isReschedule && step === 'confirm' && (business.deposit_ron ?? 0) > 0 && combo.price > 0 ? (
        <>
          <SectionTitle>{tr('book.tipTitle')}</SectionTitle>
          <Text style={[styles.note, { color: t.colors.textMuted }]}>{tr('book.tipHint')}</Text>
          <View style={styles.serviceList}>
            {tipOptions(combo.price).map((o) => (
              <Pressable
                key={o.percent}
                onPress={() => {
                  setTipRon(o.amount);
                  setTipCustom('');
                }}
                style={[
                  styles.serviceChip,
                  {
                    backgroundColor: tipRon === o.amount ? t.colors.accentSoft : t.colors.surface,
                    borderColor: tipRon === o.amount ? t.colors.accent : t.colors.border,
                  },
                ]}
              >
                <Text style={[styles.serviceName, { color: t.colors.text }]}>
                  {o.percent === 0 ? tr('book.tipNone') : `${o.percent}% · ${formatRon(o.amount)}`}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.note, { color: t.colors.textMuted }]}>{tr('book.tipCustom')}</Text>
          <TextInput
            value={tipCustom}
            onChangeText={(v: string) => {
              setTipCustom(v);
              const parsed = parseTipInput(v, combo.price);
              if (parsed !== null) {
                setTipRon(parsed);
              }
            }}
            placeholder="0"
            placeholderTextColor={t.colors.textFaint}
            keyboardType="decimal-pad"
            style={[styles.tipInput, { color: t.colors.text, borderColor: t.colors.borderStrong, backgroundColor: t.colors.surface }]}
          />
        </>
      ) : null}

      {(business.loyalty_every ?? 0) >= 2 && step === 'confirm' ? (
        <Callout tone="accent" title={tr('book.loyalty')}>
          {tr('book.loyaltyDesc', { n: business.loyalty_every ?? 0 })}
        </Callout>
      ) : null}

      {step === 'staff' ? (
        <>
          <SectionTitle>{tr('book.pickStaff')}</SectionTitle>
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
                  accessibilityLabel={tr('book.staffA11y', { name: s.name })}
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
          {selectedStaff ? (
            <StaffPortfolio urls={selectedStaff.portfolio_urls} name={selectedStaff.name} />
          ) : null}
        </>
      ) : null}

      {step === 'service' && selectedStaff ? (
        <StaffPortfolio urls={selectedStaff.portfolio_urls} name={selectedStaff.name} />
      ) : null}

      {step === 'service' ? (
        <>
          <SectionTitle>{tr('book.pickServiceTitle')}</SectionTitle>
          {combo.count > 1 ? (
            <Text style={[styles.note, { color: t.colors.textMuted }]}>
              {tr('book.comboSummary', {
                name: combo.name,
                duration: formatDuration(combo.durationMinutes),
                price: formatRon(combo.price),
              })}
            </Text>
          ) : null}
          <View style={styles.serviceList}>
            {offeredServices.map((s) => {
              const on = serviceIds.includes(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setServiceIds((ids) => toggleServiceId(ids, s.id));
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
          <SectionTitle>{tr('pick.dateTitle')}</SectionTitle>
          <DatePickerField
            label={tr('book.dateLabel')}
            value={dateLocal}
            onChange={(ymd) => {
              setDateLocal(ymd);
              setSelected(null);
            }}
            onIssueChange={(issue) => {
              setDateIssue(issue);
              if (issue) setSelected(null);
            }}
            minimumDate={minDate}
            maximumDate={maxDate}
          />
          {dateIssue ? (
            <Callout tone="warning">
              {tr(dateIssue === 'incomplete' ? 'book.dateInvalid' : 'book.dateOutOfRange')}
            </Callout>
          ) : null}
          {selectedStaff ? (
            <Text style={[styles.note, { color: t.colors.textMuted }]}>
              {tr('book.staffLine', {
                staff: selectedStaff.name,
                service: combo.count > 0 ? ` · ${combo.name}` : '',
              })}
            </Text>
          ) : null}
        </>
      ) : null}

      {step === 'slot' ? (
        <>
          <SectionTitle>{tr('book.pickTime')}</SectionTitle>
          <View
            style={[
              styles.timeLocked,
              { backgroundColor: t.colors.surface, borderColor: t.colors.borderStrong },
            ]}
          >
            <View style={styles.timeLockedLeft}>
              <Ionicons name="time-outline" size={16} color={t.colors.textMuted} />
              <Text style={[styles.timeLockedLabel, { color: t.colors.textMuted }]}>
                {tr('book.chosenTime')}
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
            <Badge tone="accent">{tr('book.freeCount', { n: slots.length })}</Badge>
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
                  ? tr('book.dayBlocked')
                  : tr('book.noSlots', {
                      date: dateLocal,
                      h: Math.max(1, Math.ceil((business.min_notice_minutes ?? 0) / 60)),
                    })
              }
            />
          )}
        </>
      ) : null}

      {selected && selectedOffpeak && (step === 'slot' || step === 'confirm') ? (
        <Badge tone="accent">{tr('book.offpeakBadge', { percent: offpeakPct })}</Badge>
      ) : null}

      {step === 'confirm' ? (
        <>
          <SectionTitle>{tr('book.confirmTitle')}</SectionTitle>
          <View
            style={[
              styles.confirmCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <ConfirmLine label={tr('book.salon')} value={business.name} />
            {selectedStaff ? <ConfirmLine label={tr('book.stepStaff')} value={selectedStaff.name} /> : null}
            {combo.count > 0 ? (
              <ConfirmLine
                label={tr('book.stepService')}
                value={`${combo.name} · ${formatDuration(combo.durationMinutes)} · ${formatRon(selectedOffpeak ? discountedPrice(combo.price, offpeakPct) : combo.price)}`}
              />
            ) : (
              <ConfirmLine label={tr('book.duration')} value={`${durationMinutes} min`} />
            )}
            <ConfirmLine label={tr('book.date')} value={dateLocal} />
            <ConfirmLine label={tr('book.time')} value={selected?.labelLocal ?? '—'} />
            {!isReschedule ? (
              <ConfirmLine
                label={tr('book.repeat')}
                value={repeatCount === 1 ? tr('book.once') : tr('book.weekly', { n: repeatCount })}
              />
            ) : null}
          </View>
          {!isReschedule ? (
            <Segmented
              value={String(repeatCount)}
              onChange={(v) => setRepeatCount(normalizeRepeatSelection(Number(v)))}
              options={[
                { value: '1', label: tr('book.onceShort') },
                { value: '2', label: tr('book.times2') },
                { value: '3', label: tr('book.times3') },
                { value: '4', label: tr('book.times4') },
              ]}
            />
          ) : null}
          <LocationCard location={locationFromBusiness(business)} />
          <Text style={[styles.note, { color: t.colors.textFaint }]}>
            {isReschedule ? tr('book.reschedNote') : tr('book.submitNote')}
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
  publicCode,
}: {
  business: BusinessProfile;
  address: string | null;
  rating: { avg: number | null; count: number } | null;
  reviews: ReviewSnippet[];
  favorited: boolean;
  onToggleFavorite: () => void;
  publicCode: string;
}) {
  const t = useTheme();
  const tr = useT();
  const [imgFailed, setImgFailed] = useState(false);
  const router = useRouter();
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
              {rating.count === 1 ? tr('book.reviewOne') : tr('book.reviewMany')}
            </Text>
          ) : (
            <Text style={[styles.profileRating, { color: t.colors.accentSoftText }]}>
              {tr('book.noReviews')}
            </Text>
          )}
          <SocialButtons instagramUrl={business.instagram_url} facebookUrl={business.facebook_url} />
          <Button
            label={tr('as.ask')}
            variant="secondary"
            size="sm"
            icon="chatbubble-ellipses-outline"
            onPress={() => router.push(`/(app)/assistant/${publicCode}` as never)}
          />
        </View>
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={favorited ? tr('fav.remove') : tr('fav.add')}
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
              {r.owner_reply?.trim() ? `\n${tr('book.ownerReply')}: ${r.owner_reply.trim()}` : ''}
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
  tipInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
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
