import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  useWindowDimensions,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';

import { BookingCalendar } from '@/components/BookingCalendar';
import { LocationCard } from '@/components/LocationCard';
import { PromoVideo } from '@/components/PromoVideo';
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
import { ImageLightbox } from '@/components/ImageLightbox';
import { setAppMode } from '@/lib/appMode';
import { ANON_BUSINESS_COLUMNS, buildPublicPageMeta, jsonLdText } from '@/lib/publicPageMeta';
import { loadPublicPageMetadata } from '@/lib/publicBusinessServer';
import { shareBusinessLink } from '@/lib/shareBusiness';
import { getPublicWebOrigin } from '@/lib/webBase';
import {
  firstBookableDateForStaff,
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
import {
  createAppointmentIfFree,
  createAppointmentMultiIfFree,
  createGuestAppointment,
  createGuestAppointmentMulti,
  listBusyRanges,
  notifyAfterBooking,
} from '@/lib/bookingRpc';
import { comboTotals, toggleServiceIdKeepOne } from '@/lib/serviceCombo';
import { isEmbedParam } from '@/lib/bookingButton';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { bookingDateRange } from '@/lib/bookingCalendar';
import { bookingStepNumbers } from '@/lib/bookingSteps';
import {
  staffForServices,
  staffOffersServices,
  staffServicesMap,
  type StaffServiceRow,
} from '@/lib/staffServices';
import { formatDuration, formatLei, formatRon } from '@/lib/format';
import {
  buildMapsUrl,
  buildNativeMapsUrl,
  formatAddress,
  hasCoordinates,
  locationFromBusiness,
  openDriveChooser,
  openMaps,
} from '@/lib/location';
import { BROWSE_CATEGORIES, businessCategoryText } from '@/lib/browseCategories';
import {
  effectiveDescription,
  normalizeGalleryUrls,
  presentationEnabled,
  telUrl,
  whatsAppUrl,
} from '@/lib/businessPage';
import { formatTimeRange } from '@/lib/workingHoursRules';
import { trKey, translateTo, useLanguage, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { markWaitlistBooked } from '@/lib/notify-client';
import { normalizeWalkinContact } from '@/lib/walkinRules';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { parseTipInput, tipOptions } from '@/lib/tip';
import { generateFreeSlots } from '@/lib/slots';
import { normalizePortfolioUrls } from '@/lib/staffPortfolio';
import { createRequestTracker } from '@/lib/latestRequest';
import { localDayBoundsUtc } from '@/lib/timezone';
import { fireAndForget } from '@/lib/fireAndForget';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, DayKey, FreeSlot, Service, Staff } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

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
  const { lang } = useLanguage();
  const { publicCode, embed, date: requestedDate } = useLocalSearchParams<{
    publicCode: string;
    embed?: string;
    date?: string;
  }>();
  // ?embed=1: pagina e într-un iframe pe site-ul salonului (ecranul „Butonul tău de programare”).
  const embedded = isEmbedParam(embed);
  const { width: windowWidth } = useWindowDimensions();
  const isWide = windowWidth >= 900;
  const code = String(publicCode ?? '').trim();
  const [session, setSession] = useState<Session | null>(null);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  // „Servicii oferite” (v67): staff_id -> servicii; fără rânduri = face tot.
  const [staffServices, setStaffServices] = useState<Record<string, string[]>>({});
  // null = „Oricine disponibil” (implicit). Altfel id-ul specialistului ales.
  const [staffId, setStaffId] = useState<string | null>(null);
  // Telefoanele marcate publice de firmă (RPC get_public_staff_phones): staff_id -> telefon.
  const [staffPhones, setStaffPhones] = useState<Record<string, string>>({});
  // Oricine: pentru fiecare oră liberă, specialiștii liberi atunci (în ordinea echipei).
  const [freeStaffByStart, setFreeStaffByStart] = useState<Record<string, string[]>>({});
  // Serviciile alese (combinat, v71): durate și prețuri adunate; primul = serviciul principal.
  const [serviceIds, setServiceIds] = useState<string[]>([]);
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
  /** Serviciile / echipa nu s-au putut citi: arătăm eroare + Reîncearcă, nu un catalog gol. */
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [error, setError] = useTransientMessage();
  const [message, setMessage] = useTransientMessage();
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Poze care nu se încarcă (URL stricat): nu le mai desenăm deloc.
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const markImageBroken = useCallback((url: string) => {
    setBrokenImages((prev) => (prev[url] ? prev : { ...prev, [url]: true }));
  }, []);
  const [tipRon, setTipRon] = useState(0);
  const [tipCustom, setTipCustom] = useState('');

  const combo = useMemo(() => comboTotals(services, serviceIds), [services, serviceIds]);
  const selectedStaff = useMemo(
    () => staffList.find((s) => s.id === staffId) ?? null,
    [staffList, staffId]
  );
  // Specialiștii care fac toate serviciile alese (Echipa, Oricine, calendar).
  const eligibleStaff = useMemo(
    () => staffForServices(staffList, staffServices, serviceIds),
    [staffList, staffServices, serviceIds]
  );
  // Specialistul ales nu face noua selecție -> înapoi la „Oricine disponibil”.
  useEffect(() => {
    if (staffId && !staffOffersServices(staffServices, staffId, serviceIds)) {
      setStaffId(null);
      setSelected(null);
    }
  }, [staffId, staffServices, serviceIds]);
  const durationMinutes =
    combo.count > 0 ? combo.durationMinutes : business?.session_duration_minutes ?? 60;

  // Data implicită urmează alegerea: specialistul ales sau, la „Oricine disponibil”,
  // prima zi în care lucrează măcar un specialist eligibil pentru serviciile alese.
  useEffect(() => {
    if (!business || loading) return;
    const first = firstBookableDateForStaff(
      business,
      selectedStaff ? [selectedStaff] : eligibleStaff,
      durationMinutes
    );
    // Linkul din emailul „Loc eliberat” deschide direct ziua respectivă (?date=YYYY-MM-DD).
    const wanted = typeof requestedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : null;
    setDateLocal(wanted && wanted >= first ? wanted : first);
  }, [business, loading, selectedStaff, eligibleStaff, durationMinutes, requestedDate]);

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

      // Restul depinde doar de business → toate cererile pleacă odată.
      const [
        { data: svcRows, error: svcErr },
        { data: staffRows, error: staffErr },
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
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }),
          supabase
            .from('staff')
            .select('*')
            .eq('business_id', biz.id)
            .eq('active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true }),
          supabase.rpc('business_rating', { p_business_id: biz.id }),
          supabase.rpc('list_public_reviews', { p_business_id: biz.id, p_limit: 5 }),
          supabase.rpc('get_public_staff_phones', { p_business_id: biz.id }),
        ]);
      if (svcErr || staffErr) {
        setCatalogFailed(true);
        setLoading(false);
        return;
      }
      const list = (svcRows ?? []) as Service[];
      setServices(list);
      if (list.length > 0) setServiceIds([list[0].id]);

      const team = (staffRows ?? []) as Staff[];
      setStaffList(team);
      let offered: Record<string, string[]> = {};
      if (team.length > 0) {
        const { data: offeredRows, error: offeredErr } = await supabase
          .from('staff_services')
          .select('staff_id, service_id')
          .in('staff_id', team.map((m) => m.id));
        if (offeredErr) {
          setCatalogFailed(true);
          setLoading(false);
          return;
        }
        offered = staffServicesMap(offeredRows as StaffServiceRow[] | null);
      }
      setStaffServices(offered);
      const phones: Record<string, string> = {};
      for (const p of (Array.isArray(phoneRows) ? phoneRows : []) as { staff_id: string; phone: string }[]) {
        if (p?.staff_id && p.phone) phones[p.staff_id] = p.phone;
      }
      setStaffPhones(phones);

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
      setCatalogFailed(false);
      setLoading(false);
    })();
  }, [code, loadAttempt]);

  // Doar ultima încărcare de sloturi are voie să scrie starea (tastarea datei cifră cu cifră
  // pornește câte o cerere pe dată intermediară; un răspuns vechi nu suprascrie unul nou).
  const slotsRequests = useRef(createRequestTracker()).current;
  const scrollRef = useRef<ScrollView | null>(null);
  const bookingY = useRef(0);

  function scrollToBooking() {
    scrollRef.current?.scrollTo({ y: Math.max(0, bookingY.current - 12), animated: true });
  }

  // Formularul de invitat stă sub ore (nu în bara fixă): după alegerea orei îl aducem în vedere.
  const guestFormY = useRef(0);
  const guestFormScrollPending = useRef(false);

  function scrollToGuestForm() {
    scrollRef.current?.scrollTo({ y: Math.max(0, guestFormY.current - 12), animated: true });
  }

  function selectSlot(slot: FreeSlot) {
    setSelected(slot);
    if (session) return;
    if (selected) scrollToGuestForm();
    else guestFormScrollPending.current = true;
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
        eligibleStaff.map((member) =>
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
        eligibleStaff.map((member, i) => {
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
  }, [business, dateLocal, durationMinutes, staffId, staffList, eligibleStaff, selectedStaff, slotsRequests]);

  useEffect(() => {
    void loadSlots();
  }, [loadSlots]);

  // Titlul din browser și limba documentului urmează limba paginii, nu rămân fixe pe română.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !business) return;
    document.documentElement.lang = lang === 'en' ? 'en' : 'ro';
    const city = (business.city ?? '').trim();
    document.title = `${business.name}${city ? ` – ${city}` : ''} | ${translateTo(lang, 'pub.online')}`;
  }, [business, lang]);

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

  // Date structurate (JSON-LD) pentru motoarele de căutare. Titlul, descrierea și Open Graph
  // vin deja în HTML-ul de server (generateMetadata, mai jos).
  useEffect(() => {
    if (Platform.OS !== 'web' || !business || typeof document === 'undefined') return;
    const json = jsonLdText(
      buildPublicPageMeta({ business, rating, origin: getPublicWebOrigin() }).jsonLd
    );
    if (!json) return;
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.text = json;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, [business, rating]);

  async function handleSharePage() {
    if (!business) return;
    try {
      if ((await shareBusinessLink(business)) === 'copied') setMessage(trKey('page.linkCopied'));
    } catch {
      // Partajare indisponibilă / anulată: nimic de făcut.
    }
  }

  function goLogin() {
    // În iframe sesiunea nu se păstrează: contul se deschide în tab nou, pe pagina normală.
    if (embedded && Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(getWebBookingUrl(code), '_blank', 'noopener');
      return;
    }
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
        const r =
          serviceIds.length > 1
            ? await createAppointmentMultiIfFree({
                businessId: business.id,
                startAt: selected.startUtc,
                endAt: selected.endUtc,
                serviceIds,
                staffId: candidate,
              })
            : await createAppointmentIfFree({
                businessId: business.id,
                startAt: selected.startUtc,
                endAt: selected.endUtc,
                serviceId: serviceIds[0] ?? null,
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
        const guest = { name, phone: contact.phone, email: contact.email };
        const r =
          serviceIds.length > 1
            ? await createGuestAppointmentMulti({
                businessId: business.id,
                startAt: selected.startUtc,
                serviceIds,
                staffId: candidate,
                ...guest,
              })
            : await createGuestAppointment({
                businessId: business.id,
                startAt: selected.startUtc,
                endAt: selected.endUtc,
                serviceId: serviceIds[0] ?? null,
                staffId: candidate,
                ...guest,
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
      // Lista de așteptare ține un singur serviciu: primul ales.
      p_service_id: serviceIds[0] ?? null,
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
          description={tr('pub.bizMissingDesc')}
          action={
            session ? (
              <Button label={tr('pub.backToAccount')} onPress={goBack} icon="arrow-back-outline" />
            ) : (
              <Button
                label={tr('pub.backHome')}
                onPress={() => router.replace('/' as never)}
                icon="home-outline"
              />
            )
          }
        />
      </Screen>
    );
  }

  const dayBlocked = (business.blocked_dates ?? []).includes(dateLocal);
  // --- Pagina de prezentare (Faza 1): totul derivă din datele deja încărcate. ---
  const pageOn = presentationEnabled(business.website_enabled);
  const category = BROWSE_CATEGORIES.find((c) => c.key === business.category) ?? null;
  const categoryCity = [businessCategoryText(business, lang), business.city]
    .filter(Boolean)
    .join(' · ');
  const coverSource = business.cover_url
    ? { uri: business.cover_url }
    : (category?.image ?? null);
  const gallery = normalizeGalleryUrls(business.gallery_urls).filter((u) => !brokenImages[u]);
  // Coperta = imaginile din galerie. Fără galerie, rămâne coperta firmei. Fără poze de profil.
  const coverSlides: { key: string; source: ImageSourcePropType; url?: string }[] =
    gallery.length > 0
      ? gallery.map((url) => ({ key: url, source: { uri: url }, url }))
      : coverSource
        ? [{ key: 'business-cover', source: coverSource }]
        : [];
  const descriptionText = effectiveDescription({
    description: business.description,
    name: business.name,
    categoryLabel: businessCategoryText(business, lang),
    city: business.city,
    county: business.county,
    serviceNames: services.map((s) => s.name),
    lang,
  });
  const callHref = telUrl(business.contact_phone);
  const whatsHref = whatsAppUrl(business.contact_phone);
  const location = locationFromBusiness(business);
  const mapsHref = buildMapsUrl(location);
  const canDrive = hasCoordinates(location);
  const reviewCount = rating?.review_count ?? 0;
  const latestWorks: string[] = [];
  for (const member of staffList) {
    const urls = normalizePortfolioUrls(member.portfolio_urls).filter((u) => !brokenImages[u]);
    for (let i = urls.length - 1; i >= 0 && latestWorks.length < 12; i--) {
      const url = urls[i];
      if (!latestWorks.includes(url)) latestWorks.push(url);
    }
  }
  const latestSlides: LatestSlide[] = latestWorks.map((url) => ({
    key: `work:${url}`,
    kind: 'work' as const,
    url,
  }));
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
  // Pașii se numerotează doar dintre cei afișați (fără servicii -> 1. Dată, 2. Oră).
  const stepNo = bookingStepNumbers({ service: services.length > 0, date: true, time: true });
  // Calendar: azi..azi+max_advance_days; zi închisă după programul specialistului ales,
  // iar la „Oricine” zi deschisă dacă lucrează măcar un specialist.
  const { minYmd, maxYmd } = bookingDateRange(business);
  const calendarSchedules = selectedStaff
    ? [staffSchedule(selectedStaff, business).workingHours]
    : (staffList.length > 0 ? eligibleStaff : [null]).map(
        (m) => staffSchedule(m, business).workingHours
      );
  // "de la X lei" doar când toate serviciile au preț (minimul > 0).
  const minPrice =
    services.length > 0 ? Math.min(...services.map((s) => Number(s.price) || 0)) : 0;
  // Echipa arată toți specialiștii activi, nu doar pe cei ai serviciului bifat.
  // 2 carduri pe rând (1 sub 360px), primul „Oricine disponibil”.
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
            const canPick = !id || staffOffersServices(staffServices, id, serviceIds);
            const phone = id ? staffPhones[id] : undefined;
            const phoneHref = phone ? telUrl(phone) : null;
            const portfolio = member
              ? normalizeGalleryUrls(member.portfolio_urls)
                  .filter((u) => !brokenImages[u])
                  .slice(0, 3)
              : [];
            // Fără poză sau poză stricată -> cercul cu inițiale.
            const photo =
              member?.photo_url && !brokenImages[member.photo_url] ? member.photo_url : null;
            const name = member ? member.name : tr('pub.anyStaff');
            return (
              <Pressable
                key={id ?? 'any'}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !canPick }}
                accessibilityLabel={name}
                disabled={!canPick}
                onPress={() => {
                  setStaffId(id);
                  setSelected(null);
                }}
                style={[
                  styles.teamCard,
                  teamCellStyle,
                  canPick ? null : styles.teamCardOff,
                  {
                    backgroundColor: on ? TEAM_SELECTED_BG : t.colors.surface,
                    borderColor: on ? TEAM_SELECTED : t.colors.border,
                  },
                ]}
              >
                {photo ? (
                  <Image
                    source={{ uri: photo }}
                    style={styles.teamPhoto}
                    onError={() => markImageBroken(photo)}
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
                          onError={() => markImageBroken(url)}
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

  const hoursSection = (
    <>
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
    </>
  );

  return (
    <Screen
      wide
      title={business.name}
      subtitle={tr('pub.online')}
      scrollRef={scrollRef}
      onBack={goBack}
      headerRight={
        reviewCount >= 3 && rating?.avg_rating != null ? (
          <View style={styles.headerScore}>
            <Text style={[styles.reviewStars, { color: t.colors.accent }]}>
              {'★'.repeat(Math.min(5, Math.max(1, Math.round(Number(rating.avg_rating)))))}
            </Text>
            <Text style={[styles.headerScoreText, { color: t.colors.textMuted }]} numberOfLines={1}>
              {Number(rating.avg_rating).toFixed(1)} · {tr('page.reviewCount', { n: reviewCount })}
            </Text>
          </View>
        ) : null
      }
      footer={
        <>
          {catalogFailed ? (
            <>
              <Callout tone="danger">{tr('pub.catalogFail')}</Callout>
              <Button
                label={tr('common.retry')}
                icon="refresh-outline"
                variant="secondary"
                onPress={() => {
                  setLoading(true);
                  setLoadAttempt((n) => n + 1);
                }}
              />
            </>
          ) : null}
          {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
          {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}
          {/* În iframe pe site-ul salonului bara fixă ar acoperi pagina gazdă. */}
          {embedded ? null : (
            <Button
              label={tr('page.bookNow')}
              icon="calendar-outline"
              onPress={scrollToBooking}
            />
          )}
          {session ? (
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
          ) : null}
        </>
      }
    >
      {pageOn && coverSlides.length > 0 ? (
        <SpecialistCover
          slides={coverSlides}
          wide={isWide}
          badge={tr('book.freeCount', { n: slots.length })}
          onImageError={markImageBroken}
        />
      ) : pageOn ? (
        <View style={styles.coverBadgeRow}>
          <Badge tone="accent">{tr('book.freeCount', { n: slots.length })}</Badge>
        </View>
      ) : null}

      {!pageOn ? <View style={[styles.summary, { backgroundColor: t.colors.accentSoft }]}>
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
      </View> : null}

      {pageOn ? (
        <>
          <View style={isWide ? styles.wideRow : undefined}>
            <View style={isWide ? styles.wideMain : styles.colGap}>
              <SectionTitle>{tr('page.about')}</SectionTitle>
              <Text style={[styles.bodyText, { color: t.colors.text }]}>{descriptionText}</Text>
              {formatAddress(location) ? (
                <Text style={[styles.summaryMeta, { color: t.colors.textMuted }]}>
                  <Ionicons name="location-outline" size={14} color={t.colors.textMuted} />{' '}
                  {formatAddress(location)}
                </Text>
              ) : null}
              {minPrice > 0 ? (
                <Text style={[styles.summaryMeta, { color: t.colors.textMuted }]}>
                  <Ionicons name="pricetag-outline" size={14} color={t.colors.textMuted} />{' '}
                  {tr('page.priceFrom', { price: formatRon(minPrice) })}
                </Text>
              ) : null}

              <View style={styles.contactRow}>
                  <ContactChip
                    icon="share-social-outline"
                    label={tr('page.share')}
                    onPress={() => void handleSharePage()}
                  />
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
                  {canDrive ? (
                    <ContactChip
                      icon="navigate"
                      label={tr('appt.driveNow')}
                      onPress={() => void openDriveChooser(location)}
                      role="button"
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
              {business.promo_video_url ? (
                <PromoVideo
                  videoUrl={business.promo_video_url}
                  title={business.name}
                  poster={business.cover_url}
                />
              ) : null}
              {teamSection}
            </View>
          </View>


        </>
      ) : null}

      <ImageLightbox uri={lightbox} onClose={() => setLightbox(null)} />

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

      {session && (business.deposit_ron ?? 0) > 0 && combo.price > 0 ? (
        <>
          <SectionTitle>{tr('book.tipTitle')}</SectionTitle>
          <Text style={[styles.summaryMeta, { color: t.colors.textMuted }]}>
            {tr('book.tipHint')}
          </Text>
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
          <Field
            label={tr('book.tipCustom')}
            value={tipCustom}
            onChangeText={(v: string) => {
              setTipCustom(v);
              const parsed = parseTipInput(v, combo.price);
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
          <SectionTitle>{tr('pub.stepService', { n: stepNo.service ?? 1 })}</SectionTitle>
          <Text style={[styles.summaryMeta, { color: t.colors.textMuted }]}>
            {combo.count > 1
              ? tr('book.comboSummary', {
                  name: combo.name,
                  duration: formatDuration(combo.durationMinutes),
                  price: formatRon(combo.price),
                })
              : tr('pub.multiHint')}
          </Text>
          {staffList.length > 0 && eligibleStaff.length === 0 ? (
            <Callout tone="warning">{tr('book.errStaffService')}</Callout>
          ) : null}
          <View style={styles.serviceList}>
            {services.map((s) => {
              const on = serviceIds.includes(s.id);
              return (
                <Pressable
                  key={s.id}
                  role="checkbox"
                  aria-checked={on}
                  onPress={() => {
                    setServiceIds((ids) => toggleServiceIdKeepOne(ids, s.id));
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

      <SectionTitle>{tr('pub.stepDate', { n: stepNo.date ?? 1 })}</SectionTitle>
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

      <SectionTitle>{tr('pub.stepTime', { n: stepNo.time ?? 1 })}</SectionTitle>
      {slotsLoading ? (
        <View style={styles.slotsLoading}>
          <ActivityIndicator color={t.colors.accent} />
        </View>
      ) : (
        <SlotPicker
          slots={slots}
          selectedStartUtc={selected?.startUtc}
          onSelect={selectSlot}
          emptyLabel={
            dayBlocked
              ? tr('book.dayBlocked')
              : tr('book.noSlots', { date: dateLocal, h: Math.max(1, Math.ceil((business.min_notice_minutes ?? 0) / 60)) })
          }
        />
      )}

      {!session && selected ? (
        <View
          style={styles.guestForm}
          onLayout={(e) => {
            guestFormY.current = e.nativeEvent.layout.y;
            if (guestFormScrollPending.current) {
              guestFormScrollPending.current = false;
              scrollToGuestForm();
            }
          }}
        >
          <Field label={tr('set.displayNamePh')} placeholder={tr('pub.guestNamePh')} maxLength={80} value={guestName} onChangeText={setGuestName} onFocus={scrollToGuestForm} />
          <Field label={tr('cal.phone')} placeholder="07…" keyboardType="phone-pad" value={guestPhone} onChangeText={setGuestPhone} onFocus={scrollToGuestForm} />
          <Field label={tr('cal.email')} placeholder={tr('pub.guestEmailPh')} keyboardType="email-address" autoCapitalize="none" value={guestEmail} onChangeText={setGuestEmail} onFocus={scrollToGuestForm} />
          <Button
            label={booking ? tr('common.sending') : tr('pub.bookGuest')}
            icon="paper-plane-outline"
            onPress={() => void handleGuestBook()}
            loading={booking}
          />
          <Button
            label={tr('pub.haveAccount')}
            icon="log-in-outline"
            variant="secondary"
            onPress={goLogin}
          />
        </View>
      ) : null}

      {pageOn && (reviewSnippets.length > 0 || latestSlides.length > 0) ? (
        <>
          {reviewSnippets.length > 0 ? (
            <>
              <SectionTitle>{tr('page.reviews')}</SectionTitle>
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
                      <Text style={[styles.reviewScore, { color: t.colors.accent }]}>
                        {'★'} {Math.min(5, Math.max(1, r.rating))}
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
          {latestSlides.length > 0 ? (
            <>
            <SectionTitle>{tr('page.latest')}</SectionTitle>
            <LatestCarousel
              slides={latestSlides}
              onWorkPress={setLightbox}
              onWorkError={markImageBroken}
            />
            </>
          ) : null}
        </>
      ) : null}

      {pageOn ? hoursSection : null}
    </Screen>
  );
}

type LatestSlide = { key: string; kind: 'work'; url: string };

const COVER_HEIGHT = 210;
const COVER_HEIGHT_WIDE = 360;
const COVER_AUTO_MS = 5000;

/** Carusel cu pagini: avans automat pe web, sageti pe web, puncte peste tot. */
function useAutoCarousel(count: number) {
  const isWeb = Platform.OS === 'web';
  const scroller = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(0);

  const go = useCallback(
    (target: number, animated = true) => {
      if (count === 0) return;
      const next = ((target % count) + count) % count;
      indexRef.current = next;
      setIndex(next);
      if (width > 0) scroller.current?.scrollTo({ x: next * width, animated });
    },
    [count, width],
  );

  useEffect(() => {
    if (count > 0 && indexRef.current >= count) go(0, false);
  }, [count, go]);

  // Timer repornit la fiecare schimbare de index, deci o apasare pe sageata nu e urmata imediat de avans automat.
  useEffect(() => {
    if (!isWeb || count < 2 || width <= 0) return;
    const timer = setTimeout(() => go(indexRef.current + 1), COVER_AUTO_MS);
    return () => clearTimeout(timer);
  }, [isWeb, count, width, index, go]);

  useEffect(() => {
    if (width <= 0) return;
    scroller.current?.scrollTo({ x: indexRef.current * width, animated: false });
  }, [width]);

  const sync = (offsetX: number) => {
    if (width <= 0 || count === 0) return;
    const next = Math.max(0, Math.min(count - 1, Math.round(offsetX / width)));
    indexRef.current = next;
    setIndex(next);
  };

  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  return { isWeb, scroller, index, width, go, sync, onLayout };
}

function CarouselControls({
  count,
  index,
  showArrows,
  onGo,
}: {
  count: number;
  index: number;
  showArrows: boolean;
  onGo: (target: number) => void;
}) {
  const tr = useT();
  if (count < 2) return null;
  return (
    <>
      {showArrows ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('page.prevPhoto')}
            onPress={() => onGo(index - 1)}
            style={({ pressed }) => [styles.carouselArrow, styles.carouselArrowLeft, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="chevron-back" size={20} color="#ffffff" />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('page.nextPhoto')}
            onPress={() => onGo(index + 1)}
            style={({ pressed }) => [styles.carouselArrow, styles.carouselArrowRight, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name="chevron-forward" size={20} color="#ffffff" />
          </Pressable>
        </>
      ) : null}
      <View style={styles.carouselDots}>
        {Array.from({ length: count }, (_, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`${i + 1} / ${count}`}
            accessibilityState={{ selected: i === index }}
            hitSlop={6}
            onPress={() => onGo(i)}
            style={[styles.carouselDot, i === index ? styles.carouselDotActive : null]}
          />
        ))}
      </View>
    </>
  );
}

function SpecialistCover({
  slides,
  wide,
  badge,
  onImageError,
}: {
  slides: { key: string; source: ImageSourcePropType; url?: string }[];
  wide: boolean;
  badge: string;
  onImageError: (url: string) => void;
}) {
  const t = useTheme();
  const height = wide ? COVER_HEIGHT_WIDE : COVER_HEIGHT;
  const count = slides.length;
  const { isWeb, scroller, index, width, go, sync, onLayout } = useAutoCarousel(count);

  return (
    <View
      style={[
        styles.cover,
        wide ? styles.coverWide : null,
        styles.coverClip,
        { backgroundColor: t.colors.surfaceMuted },
      ]}
      onLayout={onLayout}
    >
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          scrollEnabled={!isWeb && count > 1}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => sync(e.nativeEvent.contentOffset.x)}
          onScrollEndDrag={(e) => sync(e.nativeEvent.contentOffset.x)}
        >
          {slides.map((s) => (
            <Image
              key={s.key}
              source={s.source}
              style={{ width, height }}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              onError={s.url ? () => onImageError(s.url as string) : undefined}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.coverBadge} pointerEvents="none">
        <Badge tone="accent">{badge}</Badge>
      </View>
      <CarouselControls count={count} index={index} showArrows={isWeb} onGo={go} />
    </View>
  );
}

function LatestCarousel({
  slides,
  onWorkPress,
  onWorkError,
}: {
  slides: LatestSlide[];
  onWorkPress: (url: string) => void;
  onWorkError: (url: string) => void;
}) {
  const t = useTheme();
  const count = slides.length;
  const { isWeb, scroller, index, width, go, sync, onLayout } = useAutoCarousel(count);

  return (
    <View
      style={[styles.latestClip, { backgroundColor: t.colors.surfaceMuted }]}
      onLayout={onLayout}
    >
      {width > 0 ? (
        <ScrollView
          ref={scroller}
          horizontal
          pagingEnabled
          scrollEnabled={!isWeb && count > 1}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => sync(e.nativeEvent.contentOffset.x)}
          onScrollEndDrag={(e) => sync(e.nativeEvent.contentOffset.x)}
        >
          {slides.map((slide) => (
            <Pressable
              key={slide.key}
              accessibilityRole="imagebutton"
              onPress={() => onWorkPress(slide.url)}
            >
              <Image
                source={{ uri: slide.url }}
                style={{ width, height: 240 }}
                resizeMode="cover"
                accessibilityIgnoresInvertColors
                onError={() => onWorkError(slide.url)}
              />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <CarouselControls count={count} index={index} showArrows={isWeb} onGo={go} />
    </View>
  );
}
function ContactChip({
  icon,
  label,
  onPress,
  role = 'link',
}: {
  icon:
    | 'call-outline'
    | 'logo-whatsapp'
    | 'logo-instagram'
    | 'logo-facebook'
    | 'map-outline'
    | 'share-social-outline'
    | 'navigate';
  label: string;
  onPress: () => void;
  role?: 'link' | 'button';
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={role}
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
  cover: { width: '100%', height: COVER_HEIGHT, borderRadius: radius.lg },
  coverWide: { height: COVER_HEIGHT_WIDE },
  coverClip: { overflow: 'hidden', position: 'relative' },
  coverBadge: { position: 'absolute', top: spacing.md, right: spacing.md },
  coverBadgeRow: { alignItems: 'flex-end' },
  wideRow: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  wideMain: { flex: 1.6, gap: spacing.md, minWidth: 0 },

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
  reviewStars: { fontSize: fontSize.md },
  reviewScore: { fontSize: fontSize.xs, fontWeight: '700' },
  teamCardOff: { opacity: 0.5 },
  headerScore: { alignItems: 'flex-end', maxWidth: 140 },
  headerScoreText: { fontSize: fontSize.xs },
  latestClip: {
    width: '100%',
    height: 240,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  carouselArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 18, 34, 0.55)',
  },
  carouselArrowLeft: { left: spacing.sm },
  carouselArrowRight: { right: spacing.sm },
  carouselDots: {
    position: 'absolute',
    bottom: spacing.sm,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  carouselDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
  carouselDotActive: { width: 18, backgroundColor: '#ffffff' },

  hoursCard: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  hoursDay: { fontSize: fontSize.sm },
  hoursVal: { fontSize: fontSize.sm },
  guestForm: { gap: 12, marginTop: spacing.lg },
});

/**
 * Meta per salon în HTML-ul de server (titlu, descriere, canonical, Open Graph, Twitter).
 * Rulează doar pe server (SSR web); salon lipsă / pagină oprită -> meta generice + noindex.
 */
export async function generateMetadata(_request: unknown, params: Record<string, string | string[]>) {
  const raw = params.publicCode;
  return loadPublicPageMetadata(Array.isArray(raw) ? raw[0] : raw);
}
