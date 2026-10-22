import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';

import { BookingCalendar } from '@/components/BookingCalendar';
import { LocationCard } from '@/components/LocationCard';
import { SlotPicker } from '@/components/SlotPicker';
import {
  Badge,
  Button,
  Callout,
  ErrorState,
  Field,
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
  notBeforeUtc,
  staffSchedule,
  toYmd,
} from '@/lib/bookingRules';
import {
  bookWithFirstFreeStaff,
  bookingStaffCandidates,
  unionStaffSlots,
} from '@/lib/anyStaff';
import { createAppointmentIfFree, createGuestAppointment, listBusyRanges, notifyAfterBooking } from '@/lib/bookingRpc';
import { bookingDateRange } from '@/lib/bookingCalendar';
import { formatDuration, formatLei, formatRon } from '@/lib/format';
import {
  buildMapsUrl,
  buildNativeMapsUrl,
  formatAddress,
  locationFromBusiness,
  openMaps,
} from '@/lib/location';
import { BROWSE_CATEGORIES, categoryLabelForKey } from '@/lib/browseCategories';
import {
  effectiveDescription,
  normalizeGalleryUrls,
  presentationEnabled,
  telUrl,
  whatsAppUrl,
} from '@/lib/businessPage';
import { formatTimeRange } from '@/lib/workingHoursRules';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { markWaitlistBooked } from '@/lib/notify-client';
import { normalizeWalkinContact } from '@/lib/walkinRules';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { parseTipInput, tipOptions } from '@/lib/tip';
import { generateFreeSlots } from '@/lib/slots';
import { createRequestTracker } from '@/lib/latestRequest';
import { localDayBoundsUtc } from '@/lib/timezone';
import { fireAndForget } from '@/lib/fireAndForget';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, DayKey, FreeSlot, Service, Staff } from '@/lib/types';

const TEAM_SELECTED = '#2dd4bf';
const TEAM_SELECTED_BG = 'rgba(45, 212, 191, 0.14)';

/** Inițialele (max. 2) pentru avatarul fără poză. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/** Public HTTPS booking page: /b/{publicCode} — works in browser without installing the app. */
export default function PublicBookScreen() {
  const t = useTheme();
  const goBack = useBack();
  const tr = useT();
  const { publicCode } = useLocalSearchParams<{ publicCode: string }>();
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 900;
  const code = String(publicCode ?? '').trim();
  const [session, setSession] = useState<Session | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  // null = „Oricine disponibil” (implicit). Altfel id-ul specialistului ales.
  const [staffId, setStaffId] = useState<string | null>(null);
  // Telefoanele marcate publice de firmă (RPC get_public_staff_phones): staff_id -> telefon.
  const [staffPhones, setStaffPhones] = useState<Record<string, string>>({});
  // Oricine: pentru fiecare oră liberă, specialiștii liberi atunci (în ordinea echipei).
  const [freeStaffByStart, setFreeStaffByStart] = useState<Record<string, string[]>>({});
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [rating, setRating] = useState<{ avg_rating: number | null; review_count: number } | null>(
    null
  );
  const [reviewSnippets, setReviewSnippets] = useState<
    { rating: number; comment: string }[]
  >([]);
  const [logoFailed, setLogoFailed] = useState(false);
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tipRon, setTipRon] = useState(0);
  const [tipCustom, setTipCustom] = useState('');

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
        setError(trKey('book.badCode'));
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
        setError(trKey('book.notFound'));
        setLoading(false);
        return;
      }
      const biz = data as BusinessProfile;
      biz.blocked_dates = Array.isArray(biz.blocked_dates) ? biz.blocked_dates : [];
      setBusiness(biz);

      // Restul depinde doar de business → toate cererile pleacă odată.
      const [
        { data: svcRows },
        { data: staffRows },
        { data: rate },
        { data: revRows },
        { data: phoneRows },
      ] =
        await Promise.all([
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
          supabase.rpc('business_rating', { p_business_id: biz.id }),
          supabase.rpc('list_public_reviews', { p_business_id: biz.id, p_limit: 5 }),
          supabase.rpc('get_public_staff_phones', { p_business_id: biz.id }),
        ]);
      const list = (svcRows ?? []) as Service[];
      setServices(list);
      if (list.length > 0) setServiceId(list[0].id);

      const team = (staffRows ?? []) as Staff[];
      setStaffList(team);
      const phones: Record<string, string> = {};
      for (const p of (Array.isArray(phoneRows) ? phoneRows : []) as { staff_id: string; phone: string }[]) {
        if (p?.staff_id && p.phone) phones[p.staff_id] = p.phone;
      }
      setStaffPhones(phones);

      // Implicit „Oricine disponibil”: prima zi în care lucrează măcar un specialist.
      const firstDays = (team.length > 0 ? team : [null]).map((member) => {
        const hours = staffSchedule(member, biz);
        return firstBookableDateYmd({
          timezone: biz.timezone,
          workingHours: hours.workingHours,
          breakHours: hours.breakHours,
          blockedDates: biz.blocked_dates ?? [],
          minNoticeMinutes: biz.min_notice_minutes ?? 0,
          maxAdvanceDays: biz.max_advance_days ?? 90,
          sessionDurationMinutes:
            list[0]?.duration_minutes ?? biz.session_duration_minutes ?? 60,
          bufferMinutes: biz.buffer_minutes ?? 0,
        });
      });
      setDateLocal(firstDays.reduce((a, b) => (b < a ? b : a)));

      const row = Array.isArray(rate) ? rate[0] : rate;
      setRating(
        row
          ? {
              avg_rating: row.avg_rating ?? null,
              review_count: Number(row.review_count ?? 0),
            }
          : null
      );
      if (Array.isArray(revRows)) {
        setReviewSnippets(
          revRows.map((r: { rating?: number; comment?: string }) => ({
            rating: Number(r.rating ?? 0) || 0,
            comment: typeof r.comment === 'string' ? r.comment : '',
          }))
        );
      }
      setLoading(false);
    })();
  }, [code]);

  // Doar ultima încărcare de sloturi are voie să scrie starea (tastarea datei cifră cu cifră
  // pornește câte o cerere pe dată intermediară; un răspuns vechi nu suprascrie unul nou).
  const slotsRequests = useRef(createRequestTracker()).current;
  const scrollRef = useRef<ScrollView | null>(null);
  const bookingY = useRef(0);

  function scrollToBooking() {
    scrollRef.current?.scrollTo({ y: Math.max(0, bookingY.current - 12), animated: true });
  }

  const loadSlots = useCallback(async () => {
    if (!business) return;
    const req = slotsRequests.start();
    setSlotsLoading(true);
    setSelected(null);
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
    const slotInput = {
      dateLocal,
      timezone: business.timezone,
      sessionDurationMinutes: durationMinutes,
      bufferMinutes: business.buffer_minutes ?? 0,
      blockedDates: business.blocked_dates ?? [],
      notBeforeUtc: notBeforeUtc(business),
    };

    // Oricine disponibil: reuniunea sloturilor libere ale fiecărui specialist activ.
    if (!staffId && staffList.length > 0) {
      const results = await Promise.all(
        staffList.map((member) =>
          listBusyRanges({
            businessId: business.id,
            fromIso: startUtc.toISOString(),
            toIso: endUtc.toISOString(),
            staffId: member.id,
          })
        )
      );
      if (!slotsRequests.isCurrent(req)) return;
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        setError(failed.error);
        setSlots([]);
        setFreeStaffByStart({});
        setSlotsLoading(false);
        return;
      }
      const union = unionStaffSlots(
        staffList.map((member, i) => {
          const hours = staffSchedule(member, business);
          return {
            staffId: member.id,
            slots: generateFreeSlots({
              ...slotInput,
              workingHours: hours.workingHours,
              breakHours: hours.breakHours,
              busy: results[i].busy,
            }),
          };
        })
      );
      setSlots(union.slots);
      setFreeStaffByStart(union.staffByStart);
      setSlotsLoading(false);
      return;
    }

    const { busy, error: err } = await listBusyRanges({
      businessId: business.id,
      fromIso: startUtc.toISOString(),
      toIso: endUtc.toISOString(),
      staffId,
    });
    if (!slotsRequests.isCurrent(req)) return;
    if (err) {
      setError(err);
      setSlots([]);
      setSlotsLoading(false);
      return;
    }
    const hours = staffSchedule(selectedStaff, business);
    setSlots(
      generateFreeSlots({
        ...slotInput,
        workingHours: hours.workingHours,
        breakHours: hours.breakHours,
        busy,
      })
    );
    setFreeStaffByStart({});
    setSlotsLoading(false);
  }, [business, dateLocal, durationMinutes, staffId, staffList, selectedStaff, slotsRequests]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  // Coperta se preîncarcă imediat pe web (fără așteptare la derulare).
  useEffect(() => {
    if (Platform.OS !== 'web' || !business?.cover_url || typeof document === 'undefined') return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = business.cover_url;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [business?.cover_url]);

  // Titlul filei din browser = numele firmei (doar web).
  useEffect(() => {
    if (Platform.OS === 'web' && business?.name && typeof document !== 'undefined') {
      document.title = business.name;
    }
  }, [business?.name]);

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
      setError(trKey('book.pickSlot'));
      return;
    }
    setBooking(true);
    setError(null);
    setMessage(null);
    // Oricine: încercăm pe rând specialiștii liberi la ora aleasă (niciodată null când există echipă).
    const { value: created, error: err } = await bookWithFirstFreeStaff(
      bookingStaffCandidates(staffId, freeStaffByStart[selected.startUtc], staffList.length),
      async (candidate) => {
        const r = await createAppointmentIfFree({
          businessId: business.id,
          startAt: selected.startUtc,
          endAt: selected.endUtc,
          serviceId,
          staffId: candidate,
        });
        return { value: r.appointment, error: r.error };
      }
    );
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
      void markWaitlistBooked({
        businessId: business.id,
        clientUserId: session.user.id,
        desiredDate: dateLocal,
      }).catch((e) => console.warn('markWaitlistBooked failed', e));
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
  }

  async function handleGuestBook() {
    if (!business || !selected) {
      setError(trKey('book.pickSlot'));
      return;
    }
    const name = guestName.trim();
    if (!name) {
      setError(trKey('pub.nameRequired'));
      return;
    }
    const { contact, error: contactErr } = normalizeWalkinContact(guestPhone, guestEmail);
    if (contactErr) {
      setError(mapBookingRpcError(contactErr));
      return;
    }
    setBooking(true);
    setError(null);
    setMessage(null);
    const { value: created, error: err } = await bookWithFirstFreeStaff(
      bookingStaffCandidates(staffId, freeStaffByStart[selected.startUtc], staffList.length),
      async (candidate) => {
        const r = await createGuestAppointment({
          businessId: business.id,
          startAt: selected.startUtc,
          endAt: selected.endUtc,
          serviceId,
          staffId: candidate,
          name,
          phone: contact.phone,
          email: contact.email,
        });
        return { value: r.appointment, error: r.error };
      }
    );
    setBooking(false);
    if (err) {
      setError(mapBookingRpcError(err));
      await loadSlots();
      return;
    }
    setSelected(null);
    setGuestName('');
    setGuestPhone('');
    setGuestEmail('');
    await loadSlots();
    setMessage(
      created?.status === 'approved'
        ? trKey('pub.confirmed')
        : trKey('pub.sentContact')
    );
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
    setMessage(trKey('pub.waitlisted'));
  }

  if (loading) {
    return <SkeletonScreen title={tr('pub.title')} onBack={goBack} blocks={5} label={tr('pub.loading')} />;
  }

  if (!business) {
    return (
      <Screen title={tr('pub.title')} onBack={goBack}>
        <ErrorState
          title={tr('pub.bizMissing')}
          description={error ?? tr('pub.badCodeShort')}
          action={
            <Button label={tr('pub.backToAccount')} onPress={goBack} icon="arrow-back-outline" />
          }
        />
      </Screen>
    );
  }

  const dayBlocked = (business.blocked_dates ?? []).includes(dateLocal);
  // --- Pagina de prezentare (Faza 1): totul derivă din datele deja încărcate. ---
  const pageOn = presentationEnabled(business.website_enabled);
  const category = BROWSE_CATEGORIES.find((c) => c.key === business.category) ?? null;
  const categoryCity = [categoryLabelForKey(business.category), business.city]
    .filter(Boolean)
    .join(' · ');
  const coverSource = business.cover_url
    ? { uri: business.cover_url }
    : (category?.image ?? null);
  const gallery = normalizeGalleryUrls(business.gallery_urls);
  const descriptionText = effectiveDescription({
    description: business.description,
    name: business.name,
    categoryLabel: categoryLabelForKey(business.category, 'ro'),
    city: business.city,
    county: business.county,
    serviceNames: services.map((s) => s.name),
  });
  const callHref = telUrl(business.contact_phone);
  const whatsHref = whatsAppUrl(business.contact_phone);
  const location = locationFromBusiness(business);
  const mapsHref = buildMapsUrl(location);
  const reviewCount = rating?.review_count ?? 0;
  const showReviews = reviewCount >= 3 && reviewSnippets.length > 0;
  const todayKey = (
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  )[new Date().getDay()] as DayKey;
  const weekDays: { key: DayKey; label: string }[] = [
    { key: 'mon', label: tr('hours.mon') },
    { key: 'tue', label: tr('hours.tue') },
    { key: 'wed', label: tr('hours.wed') },
    { key: 'thu', label: tr('hours.thu') },
    { key: 'fri', label: tr('hours.fri') },
    { key: 'sat', label: tr('hours.sat') },
    { key: 'sun', label: tr('hours.sun') },
  ];
  const noSlots = !slotsLoading && slots.length === 0;
  // Calendar: azi..azi+max_advance_days; zi închisă după programul specialistului ales,
  // iar la „Oricine” zi deschisă dacă lucrează măcar un specialist.
  const { minYmd, maxYmd } = bookingDateRange(business);
  const calendarSchedules = selectedStaff
    ? [staffSchedule(selectedStaff, business).workingHours]
    : (staffList.length > 0 ? staffList : [null]).map(
        (m) => staffSchedule(m, business).workingHours
      );
  // "de la X lei" doar când toate serviciile au preț (minimul > 0).
  const minPrice =
    services.length > 0 ? Math.min(...services.map((s) => Number(s.price) || 0)) : 0;
  // Echipa = selectorul de specialist: 2 carduri pe rând (1 sub 360px), primul „Oricine disponibil”.
  const teamCellStyle = windowWidth < 360 ? styles.teamCellFull : styles.teamCellHalf;
  const teamCards: { id: string | null; member: Staff | null }[] = [
    { id: null, member: null },
    ...staffList.map((m) => ({ id: m.id, member: m })),
  ];
  const teamSection =
    staffList.length > 0 ? (
      <>
        <SectionTitle>{tr('page.team')}</SectionTitle>
        <View style={styles.teamGrid}>
          {teamCards.map(({ id, member }) => {
            const on = staffId === id;
            const phone = id ? staffPhones[id] : undefined;
            const phoneHref = phone ? telUrl(phone) : null;
            const portfolio = member ? normalizeGalleryUrls(member.portfolio_urls).slice(0, 3) : [];
            const name = member ? member.name : tr('pub.anyStaff');
            return (
              <Pressable
                key={id ?? 'any'}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={name}
                onPress={() => {
                  setStaffId(id);
                  setSelected(null);
                }}
                style={[
                  styles.teamCard,
                  teamCellStyle,
                  {
                    backgroundColor: on ? TEAM_SELECTED_BG : t.colors.surface,
                    borderColor: on ? TEAM_SELECTED : t.colors.border,
                  },
                ]}
              >
                {member?.photo_url ? (
                  <Image
                    source={{ uri: member.photo_url }}
                    style={styles.teamPhoto}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <View
                    style={[
                      styles.teamPhoto,
                      styles.teamPhotoFallback,
                      { backgroundColor: member?.color || t.colors.accentSoft },
                    ]}
                  >
                    {member ? (
                      <Text style={styles.teamInitials}>{initialsOf(member.name)}</Text>
                    ) : (
                      <Ionicons name="people" size={22} color={t.colors.accent} />
                    )}
                  </View>
                )}
                <Text style={[styles.teamName, { color: t.colors.text }]} numberOfLines={2}>
                  {name}
                </Text>
                {member?.specialty?.trim() ? (
                  <Text style={[styles.teamSpecialty, { color: t.colors.textMuted }]} numberOfLines={2}>
                    {member.specialty.trim()}
                  </Text>
                ) : !member ? (
                  <Text style={[styles.teamSpecialty, { color: t.colors.textMuted }]} numberOfLines={2}>
                    {tr('pub.anyStaffHint')}
                  </Text>
                ) : null}
                {portfolio.length > 0 ? (
                  <View style={styles.teamPortfolio}>
                    {portfolio.map((url) => (
                      <Pressable
                        key={url}
                        accessibilityRole="imagebutton"
                        onPress={() => setLightbox(url)}
                      >
                        <Image
                          source={{ uri: url }}
                          style={styles.teamThumb}
                          resizeMode="cover"
                          accessibilityIgnoresInvertColors
                        />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {phoneHref ? (
                  <Pressable
                    accessibilityRole="link"
                    accessibilityLabel={tr('pub.callStaff', { name })}
                    onPress={() => void Linking.openURL(phoneHref)}
                    style={[styles.teamCall, { borderColor: t.colors.borderStrong }]}
                  >
                    <Ionicons name="call-outline" size={15} color={t.colors.accent} />
                    <Text style={[styles.teamCallText, { color: t.colors.text }]} numberOfLines={1}>
                      {phone}
                    </Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </>
    ) : null;

  return (
    <Screen
      wide
      title={business.name}
      subtitle={tr('pub.online')}
      scrollRef={scrollRef}
      onBack={goBack}
      footer={
        <>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {message ? <Callout tone="success">{message}</Callout> : null}
          <Button
            label={tr('page.bookNow')}
            icon="calendar-outline"
            onPress={scrollToBooking}
          />
          {!session ? (
            <>
            <View style={{ gap: 12 }}>
              <Field label={tr('set.displayNamePh')} placeholder={tr('pub.guestNamePh')} value={guestName} onChangeText={setGuestName} />
              <Field label={tr('cal.phone')} placeholder="07…" keyboardType="phone-pad" value={guestPhone} onChangeText={setGuestPhone} />
              <Field label={tr('cal.email')} placeholder={tr('pub.guestEmailPh')} keyboardType="email-address" autoCapitalize="none" value={guestEmail} onChangeText={setGuestEmail} />
              <Button
                label={booking ? tr('common.sending') : tr('pub.bookGuest')}
                icon="paper-plane-outline"
                onPress={() => void handleGuestBook()}
                loading={booking}
                disabled={!selected}
              />
            </View>
            <View style={{ height: 12 }} />
            <Button
              label={tr('pub.haveAccount')}
              icon="log-in-outline"
              onPress={goLogin}
            />
            </>
          ) : (
            <>
              <Button
                label={booking ? tr('common.sending') : tr('book.sendRequest')}
                icon="paper-plane-outline"
                onPress={() => void handleBook()}
                loading={booking}
                disabled={!selected}
              />
              {noSlots && !dayBlocked ? (
                <Button
                  label={waitlistBusy ? tr('cli.saving') : tr('pub.notifyMe')}
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
      {pageOn && coverSource ? (
        <Image
          source={coverSource}
          style={[styles.cover, { backgroundColor: t.colors.surfaceMuted }, isWide ? styles.coverWide : null]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}

      <View style={[styles.summary, { backgroundColor: t.colors.accentSoft }]}>
        <View style={[styles.summaryIcon, { backgroundColor: t.colors.surface, overflow: 'hidden' }]}>
          {business.logo_url && !logoFailed ? (
            <Image
              source={{ uri: business.logo_url }}
              style={{ width: 40, height: 40, borderRadius: radius.md }}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <Ionicons name="storefront" size={20} color={t.colors.accent} />
          )}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.summaryName, { color: t.colors.accentSoftText }]}>
            {business.name}
          </Text>
          {pageOn && categoryCity ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
              {categoryCity}
            </Text>
          ) : null}
          {formatAddress(locationFromBusiness(business)) ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]} numberOfLines={2}>
              {formatAddress(locationFromBusiness(business))}
            </Text>
          ) : null}
          {showReviews && rating ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
              ★ {Number(rating.avg_rating).toFixed(1)} · {rating.review_count} {tr('book.reviewMany')}
            </Text>
          ) : null}
          {minPrice > 0 ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
              {tr('page.priceFrom', { price: formatRon(minPrice) })}
            </Text>
          ) : null}
        </View>
        <Badge tone="accent">{tr('book.freeCount', { n: slots.length })}</Badge>
      </View>

      {pageOn ? (
        <>
          <View style={isWide ? styles.wideRow : undefined}>
            <View style={isWide ? styles.wideMain : styles.colGap}>
              <SectionTitle>{tr('page.about')}</SectionTitle>
              <Text style={[styles.bodyText, { color: t.colors.text }]}>{descriptionText}</Text>

              {callHref || whatsHref || business.instagram_url || business.facebook_url || mapsHref ? (
                <View style={styles.contactRow}>
                  {callHref ? (
                    <ContactChip
                      icon="call-outline"
                      label={tr('page.call')}
                      onPress={() => void Linking.openURL(callHref)}
                    />
                  ) : null}
                  {whatsHref ? (
                    <ContactChip
                      icon="logo-whatsapp"
                      label={tr('page.whatsapp')}
                      onPress={() => void Linking.openURL(whatsHref)}
                    />
                  ) : null}
                  {business.instagram_url ? (
                    <ContactChip
                      icon="logo-instagram"
                      label="Instagram"
                      onPress={() => void Linking.openURL(business.instagram_url as string)}
                    />
                  ) : null}
                  {business.facebook_url ? (
                    <ContactChip
                      icon="logo-facebook"
                      label="Facebook"
                      onPress={() => void Linking.openURL(business.facebook_url as string)}
                    />
                  ) : null}
                  {mapsHref ? (
                    <ContactChip
                      icon="map-outline"
                      label={tr('page.map')}
                      onPress={() => void openMaps(mapsHref, buildNativeMapsUrl(location))}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
            <View style={isWide ? styles.wideSide : styles.colGap}>
              <SectionTitle>{tr('page.hours')}</SectionTitle>
              <View
                style={[
                  styles.hoursCard,
                  { backgroundColor: t.colors.surface, borderColor: t.colors.border },
                ]}
              >
                {weekDays.map((d) => {
                  const h = business.working_hours?.[d.key];
                  const isToday = d.key === todayKey;
                  return (
                    <View key={d.key} style={styles.hoursRow}>
                      <Text
                        style={[
                          styles.hoursDay,
                          { color: t.colors.text, fontWeight: isToday ? '800' : '400' },
                        ]}
                      >
                        {d.label}
                      </Text>
                      <Text
                        style={[
                          styles.hoursVal,
                          {
                            color: isToday ? t.colors.text : t.colors.textMuted,
                            fontWeight: isToday ? '700' : '400',
                          },
                        ]}
                      >
                        {h && !h.closed
                          ? formatTimeRange(h.start, h.end, tr('hours.nextDay'))
                          : tr('hours.closed')}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <LocationCard location={location} />
            </View>
          </View>

          {teamSection}

          {gallery.length > 0 ? (
            <>
              <SectionTitle>{tr('page.gallery')}</SectionTitle>
              <View style={styles.grid}>
                {gallery.map((url) => (
                  <Pressable
                    key={url}
                    style={[styles.thumbWrap, { backgroundColor: t.colors.surfaceMuted }, isWide ? styles.thumbWrapWide : null]}
                    accessibilityRole="imagebutton"
                    onPress={() => setLightbox(url)}
                  >
                    <Image
                      source={{ uri: url }}
                      style={styles.thumb}
                      resizeMode="cover"
                      accessibilityIgnoresInvertColors
                    />
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {showReviews ? (
            <>
              <SectionTitle>{tr('page.reviews')}</SectionTitle>
              <Text style={[styles.summaryMeta, { color: t.colors.textMuted }]}>
                ★ {Number(rating?.avg_rating ?? 0).toFixed(1)} ·{' '}
                {tr('page.reviewCount', { n: reviewCount })}
              </Text>
              <View style={styles.serviceList}>
                {reviewSnippets.map((r, i) => (
                  <View
                    key={i}
                    style={[
                      styles.serviceRow,
                      { backgroundColor: t.colors.surface, borderColor: t.colors.border },
                    ]}
                  >
                    <View style={styles.flex}>
                      <Text style={[styles.reviewStars, { color: t.colors.accent }]}>
                        {'★'.repeat(Math.min(5, Math.max(1, r.rating)))}
                      </Text>
                      {r.comment?.trim() ? (
                        <Text style={[styles.serviceDesc, { color: t.colors.text }]}>
                          {r.comment.trim()}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </>
      ) : null}

      <Modal
        visible={lightbox !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightbox(null)}
      >
        <Pressable style={styles.lightbox} onPress={() => setLightbox(null)}>
          {lightbox ? (
            <Image
              source={{ uri: lightbox }}
              style={styles.lightboxImg}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Pressable>
      </Modal>

      {!pageOn ? <LocationCard location={locationFromBusiness(business)} /> : null}

      {/* Copil direct al conținutului ScrollView: layout.y e chiar offsetul de derulare. */}
      <View
        onLayout={(e) => {
          bookingY.current = e.nativeEvent.layout.y;
        }}
      />

      {(business.deposit_ron ?? 0) > 0 ? (
        <Callout tone="info" title={tr('book.deposit')}>
          {tr('book.depositDesc', { amount: formatLei(business.deposit_ron) })}
        </Callout>
      ) : null}

      {session && (business.deposit_ron ?? 0) > 0 && (selectedService?.price ?? 0) > 0 ? (
        <>
          <SectionTitle>{tr('book.tipTitle')}</SectionTitle>
          <Text style={[styles.summaryMeta, { color: t.colors.textMuted }]}>
            {tr('book.tipHint')}
          </Text>
          <View style={styles.serviceList}>
            {tipOptions(selectedService?.price ?? 0).map((o) => (
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
          <Field
            label={tr('book.tipCustom')}
            value={tipCustom}
            onChangeText={(v: string) => {
              setTipCustom(v);
              const parsed = parseTipInput(v, selectedService?.price ?? 0);
              if (parsed !== null) setTipRon(parsed);
            }}
            placeholder="0"
            keyboardType="decimal-pad"
          />
        </>
      ) : null}

      {(business.loyalty_every ?? 0) >= 2 ? (
        <Callout tone="accent" title={tr('book.loyalty')}>
          {tr('book.loyaltyDesc', { n: business.loyalty_every ?? 0 })}
        </Callout>
      ) : null}

      {/* Fără pagina de prezentare, Echipa (selectorul) apare chiar înaintea pașilor. */}
      {!pageOn ? teamSection : null}

      {services.length > 0 ? (
        <>
          <SectionTitle>{tr('pub.stepService')}</SectionTitle>
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
                  {s.description ? (
                    <Text
                      style={[styles.serviceDesc, { color: on ? t.colors.onAccent : t.colors.textMuted }]}
                      numberOfLines={3}
                    >
                      {s.description}
                    </Text>
                  ) : null}
                  <Text style={[styles.serviceMeta, { color: on ? t.colors.onAccent : t.colors.textMuted }]}>
                    {formatDuration(s.duration_minutes)} · {formatRon(s.price)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <SectionTitle>{tr('pub.stepDate')}</SectionTitle>
      <BookingCalendar
        value={dateLocal}
        onChange={(ymd) => {
          setSelected(null);
          setDateLocal(ymd);
        }}
        minYmd={minYmd}
        maxYmd={maxYmd}
        blockedDates={business.blocked_dates ?? []}
        schedules={calendarSchedules}
      />

      <SectionTitle>{tr('pub.stepTime')}</SectionTitle>
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
              ? tr('book.dayBlocked')
              : tr('book.noSlots', { date: dateLocal, h: Math.max(1, Math.ceil((business.min_notice_minutes ?? 0) / 60)) })
          }
        />
      )}
    </Screen>
  );
}

function ContactChip({
  icon,
  label,
  onPress,
}: {
  icon: 'call-outline' | 'logo-whatsapp' | 'logo-instagram' | 'logo-facebook' | 'map-outline';
  label: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.contactChip,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.borderStrong,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={17} color={t.colors.accent} />
      <Text style={[styles.contactChipText, { color: t.colors.text }]}>{label}</Text>
    </Pressable>
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
  serviceDesc: { fontSize: fontSize.sm, opacity: 0.9 },
  serviceMeta: { fontSize: fontSize.sm },
  slotsLoading: { paddingVertical: spacing['2xl'], alignItems: 'center' },
  cover: { width: '100%', height: 210, borderRadius: radius.lg },
  coverWide: { height: 360 },
  wideRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  wideMain: { flex: 1.6, gap: spacing.md, minWidth: 0 },
  wideSide: { flex: 1, gap: spacing.md, minWidth: 0 },
  thumbWrapWide: { width: '23%' },
  colGap: { gap: spacing.md },
  bodyText: { fontSize: fontSize.md, lineHeight: 23 },
  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  contactChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: spacing.touchTarget,
  },
  contactChipText: { fontSize: fontSize.sm, fontWeight: '700' },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  teamGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  teamCellHalf: { width: '48.5%' },
  teamCellFull: { width: '100%' },
  teamCard: {
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 2,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  teamPhoto: { width: 56, height: 56, borderRadius: 28 },
  teamPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  teamInitials: { color: '#ffffff', fontSize: fontSize.md, fontWeight: '800' },
  teamName: { fontSize: fontSize.md, fontWeight: '700', textAlign: 'center' },
  teamSpecialty: { fontSize: fontSize.sm, textAlign: 'center' },
  teamPortfolio: { flexDirection: 'row', gap: spacing.xs },
  teamThumb: { width: 36, height: 36, borderRadius: radius.sm },
  teamCall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    maxWidth: '100%',
  },
  teamCallText: { fontSize: fontSize.sm, fontWeight: '700', flexShrink: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { width: '31%', aspectRatio: 1 },
  thumb: { width: '100%', height: '100%', borderRadius: radius.md },
  reviewStars: { fontSize: fontSize.md },
  hoursCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  hoursDay: { fontSize: fontSize.sm },
  hoursVal: { fontSize: fontSize.sm },
  lightbox: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImg: { width: '100%', height: '100%' },
});
