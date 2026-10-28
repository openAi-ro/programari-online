import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NearbyCarousel } from '@/components/NearbyCarousel';
import { ClientTabBar } from '@/components/ClientTabBar';
import { markNavReady, measureBeforeEnabled } from '@/lib/navTiming';
import { UpdateBanner } from '@/components/UpdateBanner';
import { BizCardRow } from '@/components/BizCardRow';
import { AppModeSwitch } from '@/components/AppModeSwitch';
import { InvitationAcceptCard } from '@/components/InvitationAcceptCard';
import {
  Avatar,
  Badge,
  Banner,
  Body,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Screen,
  SectionTitle,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { getAppMode, setAppMode, type AppMode } from '@/lib/appMode';
import { fetchMyBusiness } from '@/lib/myBusiness';
import { appModeFrom, canSwitchAppMode } from '@/lib/teamAccess';
import { canConfirmAttendance, mapBookingRpcError, visitsUntilFree } from '@/lib/bookingRules';
import { extractPublicCode } from '@/lib/bookingLink';
import {
  hasLocation,
  openDriveChooser,
  type BusinessLocation,
} from '@/lib/location';
import { presentLocalBookingNotification } from '@/lib/notifications';
import { statusMeta } from '@/lib/status';
import { trKey, useT, type TrKey } from '@/lib/i18n';
import { appointmentNextHint } from '@/lib/appointmentNextHint';
import {
  getFavoriteIds,
  subscribeFavorites,
  syncFavoritesFromCloud,
  toggleFavorite,
} from '@/lib/favorites';
import { getUnreadTotal } from '@/lib/chatRpc';
import { useForegroundInterval } from '@/lib/useForegroundInterval';
import { useBusinessRole } from '@/lib/useBusinessRole';
import { formatInTimeZone } from '@/lib/timezone';
import { businessIdFilter } from '@/lib/realtimeFilters';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { AppointmentStatus } from '@/lib/types';
import { appointmentContactParts } from '@/lib/quickAddRules';

type Biz = { id: string; name: string; public_code: string; logo_url?: string | null };

type NextAppointment = {
  id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  businessId: string;
  businessName: string;
  publicCode: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  county: string | null;
  city: string | null;
  address: string | null;
  mapsUrl: string | null;
  serviceId: string | null;
  serviceName: string | null;
  staffId: string | null;
  staffName: string | null;
  attendanceConfirmed: boolean;
};

type LoyaltyCard = {
  businessId: string;
  businessName: string;
  visitCount: number;
  every: number;
  untilFree: number;
};

type RecentBusiness = {
  id: string;
  name: string;
  publicCode: string;
  timezone: string;
  lastVisitAt: string;
  lastServiceName: string | null;
  lastServiceId: string | null;
  lastStaffId: string | null;
  city: string | null;
};


const GUIDE_STEPS: TrKey[] = [
  'home.guide1',
  'home.guide2',
  'home.guide3',
  'home.guide4',
];

function pendingBannerTitle(count: number): string {
  if (count === 1) return trKey('home.pendingOne');
  return trKey('home.pendingMany', { count });
}

export default function HomeScreen() {
  const tr = useT();
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const inBusinessTabs = (segments as readonly string[]).includes('(tabs)');
  const [loading, setLoading] = useState(true);
  const [mode, setModeState] = useState<AppMode>('client');
  const [canSwitch, setCanSwitch] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<Biz | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [nextApt, setNextApt] = useState<NextAppointment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyCard[]>([]);
  const [recentBusinesses, setRecentBusinesses] = useState<RecentBusiness[]>([]);
  const [favoriteIds, setFavoriteIdsState] = useState<string[]>([]);
  const [pendingClientCount, setPendingClientCount] = useState(0);
  // Id-uri pending deja văzute — popup în bara de notificări doar la cereri NOI.
  const seenPendingRef = useRef<Set<string>>(new Set());
  const businessIdRef = useRef<string | null>(null);
  businessIdRef.current = business?.id ?? null;

  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && inBusinessTabs) {
      // eslint-disable-next-line no-console
      console.count('[TAB_MOUNT] business/home');
    }
  }, [inBusinessTabs]);
  const hasLoadedOnceRef = useRef(false);

  useEffect(() => {
    void (async () => {
      await getFavoriteIds();
      await syncFavoritesFromCloud();
    })();
    return subscribeFavorites(setFavoriteIdsState);
  }, []);


  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // Soft refresh: keep Home visible after first successful load
        const hasExistingData = hasLoadedOnceRef.current;
        if (measureBeforeEnabled() || !hasExistingData) setLoading(true);
        const user = await getCurrentUser();
        if (!user || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        setEmail(user.email ?? null);

        // Nu upsert cu phone: null — la login pe email user.phone e gol și
        // ștergea telefonul salvat din Setări la fiecare focus pe Home.
        type ProfRow = {
          email: string | null;
          phone: string | null;
          display_name: string | null;
          avatar_url: string | null;
        };
        // Profilul (cu account_kind), business-ul activ (propriu sau din echipă) și zona aleasă
        // depind doar de user.id: o singură rundă de cereri; zona vine din regula comună appModeFrom.
        const [{ data: existingProf }, data, storedMode] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, email, phone, display_name, avatar_url, account_kind')
            .eq('id', user.id)
            .maybeSingle(),
          fetchMyBusiness(user.id),
          getAppMode(),
        ]);
        const appMode = appModeFrom(existingProf?.account_kind, Boolean(data), storedMode);
        const switchable = canSwitchAppMode(existingProf?.account_kind, Boolean(data));
        void setAppMode(appMode);

        let profileRow: ProfRow | null = null;
        if (!existingProf) {
          await supabase.from('profiles').insert({
            id: user.id,
            email: user.email ?? null,
            phone: user.phone ?? null,
          });
          profileRow = {
            email: user.email ?? null,
            phone: user.phone ?? null,
            display_name: null,
            avatar_url: null,
          };
        } else {
          const patch: { email?: string | null; phone?: string | null } = {};
          if (!existingProf.email && user.email) patch.email = user.email;
          if (!existingProf.phone && user.phone) patch.phone = user.phone;
          if (Object.keys(patch).length > 0) {
            await supabase.from('profiles').update(patch).eq('id', user.id);
          }
          profileRow = {
            email: patch.email ?? existingProf.email ?? null,
            phone: patch.phone ?? existingProf.phone ?? null,
            display_name: existingProf.display_name ?? null,
            avatar_url: existingProf.avatar_url ?? null,
          };
        }

        // Cererile în așteptare (business) pleacă acum și rulează în paralel cu
        // programările clientului; le citim abia înainte de a seta starea.
        const pendingWave = data?.id
          ? Promise.all([
              supabase
                .from('appointments')
                .select('id', { count: 'exact', head: true })
                .eq('business_id', data.id)
                .eq('status', 'pending'),
              supabase
                .from('appointments')
                .select('id')
                .eq('business_id', data.id)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(50),
            ])
          : null;

        if (appMode === 'client') {
          const orParts: string[] = [];
          if (profileRow?.email) orParts.push(`client_email.eq.${profileRow.email}`);
          if (profileRow?.phone) orParts.push(`client_phone.eq.${profileRow.phone}`);

          const myOrFilter = orParts.length ? orParts.join(',') : null;
          const cols =
            'id, business_id, start_at, end_at, status, client_user_id, no_show, service_id, service_name, staff_id, staff_name, attendance_confirmed';

          // Limit: upcoming window + recent history (not full appointment list).
          const lookbackIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
          const scopedApts = () => {
            const q = supabase.from('appointments').select(cols);
            return myOrFilter
              ? q.or(`client_user_id.eq.${user.id},${myOrFilter}`)
              : q.eq('client_user_id', user.id);
          };

          const [upcomingRes, recentRes] = await Promise.all([
            scopedApts()
              .in('status', ['pending', 'approved'])
              .gte('start_at', lookbackIso)
              .order('start_at', { ascending: true })
              .limit(25),
            scopedApts()
              .order('start_at', { ascending: false })
              .limit(60),
          ]);

          type AptRow = {
            id: string;
            business_id: string;
            start_at: string;
            end_at: string;
            status: AppointmentStatus;
            no_show: boolean | null;
            service_id?: string | null;
            service_name?: string | null;
            staff_id?: string | null;
            staff_name?: string | null;
            attendance_confirmed?: boolean;
          };
          if (upcomingRes.error || recentRes.error) {
            if (!cancelled) setLoadError(trKey('home.loadFail'));
          } else if (!cancelled) {
            setLoadError(null);
          }
          const byId = new Map<string, AptRow>();
          for (const r of [...((recentRes.data ?? []) as AptRow[]), ...((upcomingRes.data ?? []) as AptRow[])]) {
            byId.set(r.id, r);
          }
          const rows = Array.from(byId.values());

          const bizIds = [...new Set(rows.map((r) => r.business_id))];
          const bizById: Record<
            string,
            {
              name: string;
              timezone: string;
              loyalty_every: number;
              public_code: string;
              latitude: number | null;
              longitude: number | null;
              county: string | null;
              city: string | null;
              address: string | null;
              maps_url: string | null;
            }
          > = {};
          const now = Date.now();
          // Datele business-urilor și vizitele încheiate nu depind unele de altele.
          const [bizRowsRes, visitRes] = await Promise.all([
            bizIds.length
              ? supabase
                  .from('business_profiles')
                  .select(
                    'id, name, timezone, loyalty_every, public_code, latitude, longitude, county, city, address, maps_url'
                  )
                  .in('id', bizIds)
              : null,
            // Vizite = doar programări aprobate deja încheiate, numărate separat
            // de fereastra recentă (limitată), ca loialitatea să nu fie plafonată.
            scopedApts()
              .eq('status', 'approved')
              .lte('end_at', new Date(now).toISOString()),
          ]);
          if (bizRowsRes) {
            const { data: bizRows, error: bizErr } = bizRowsRes;
            if (bizErr && !cancelled) setLoadError(trKey('home.loadFail'));
            for (const b of bizRows ?? []) {
              bizById[b.id] = {
                name: b.name,
                timezone: b.timezone,
                loyalty_every: b.loyalty_every ?? 0,
                public_code: b.public_code,
                latitude: typeof b.latitude === 'number' ? b.latitude : null,
                longitude: typeof b.longitude === 'number' ? b.longitude : null,
                county: b.county ?? null,
                city: b.city ?? null,
                address: b.address ?? null,
                maps_url: b.maps_url ?? null,
              };
            }
          }

          const recentMap = new Map<
            string,
            {
              lastAt: string;
              serviceName: string | null;
              serviceId: string | null;
              staffId: string | null;
            }
          >();
          for (const r of rows) {
            // Recente = doar vizite deja incheiate si confirmate (nu viitoare/anulate).
            if (r.status !== 'approved' || new Date(r.end_at).getTime() > now) continue;
            const prev = recentMap.get(r.business_id);
            if (!prev || new Date(r.start_at).getTime() > new Date(prev.lastAt).getTime()) {
              recentMap.set(r.business_id, {
                lastAt: r.start_at,
                serviceName: r.service_name ?? null,
                serviceId: r.service_id ?? null,
                staffId: r.staff_id ?? null,
              });
            }
          }
          const recentList: RecentBusiness[] = [];
          for (const [bizId, info] of recentMap) {
            const biz = bizById[bizId];
            if (!biz?.public_code) continue;
            recentList.push({
              id: bizId,
              name: biz.name,
              publicCode: biz.public_code,
              timezone: biz.timezone,
              lastVisitAt: info.lastAt,
              lastServiceName: info.serviceName,
              lastServiceId: info.serviceId,
              lastStaffId: info.staffId,
              city: biz.city ?? null,
            });
          }
          recentList.sort(
            (a, b) => new Date(b.lastVisitAt).getTime() - new Date(a.lastVisitAt).getTime()
          );

          const upcoming = rows
            .filter(
              (r) =>
                (r.status === 'pending' || r.status === 'approved') &&
                new Date(r.end_at).getTime() >= now
            )
            .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

          let next: NextAppointment | null = null;
          const first = upcoming[0];
          if (first) {
            const biz = bizById[first.business_id];
            next = {
              id: first.id,
              start_at: first.start_at,
              end_at: first.end_at,
              status: first.status,
              businessId: first.business_id,
              businessName: biz?.name ?? 'Business',
              publicCode: biz?.public_code ?? null,
              timezone: biz?.timezone ?? 'Europe/Bucharest',
              latitude: biz?.latitude ?? null,
              longitude: biz?.longitude ?? null,
              county: biz?.county ?? null,
              city: biz?.city ?? null,
              address: biz?.address ?? null,
              mapsUrl: biz?.maps_url ?? null,
              serviceId: first.service_id ?? null,
              serviceName: first.service_name ?? null,
              staffId: first.staff_id ?? null,
              staffName: first.staff_name ?? null,
              attendanceConfirmed: Boolean(first.attendance_confirmed),
            };
          }

          const { data: visitRows, error: visitErr } = visitRes;
          if (visitErr && !cancelled) setLoadError(trKey('home.loadFail'));
          const completedVisits = ((visitRows ?? []) as AptRow[]).filter((r) => !r.no_show);

          const cards: LoyaltyCard[] = [];
          for (const bizId of bizIds) {
            const biz = bizById[bizId];
            if (!biz || !biz.loyalty_every || biz.loyalty_every < 2) continue;
            const visits = completedVisits.filter(
              (r) =>
                r.business_id === bizId &&
                r.status === 'approved' &&
                !r.no_show
            ).length;
            const until = visitsUntilFree(visits, biz.loyalty_every);
            if (until == null) continue;
            cards.push({
              businessId: bizId,
              businessName: biz.name,
              visitCount: visits,
              every: biz.loyalty_every,
              untilFree: until,
            });
          }

          if (!cancelled) {
            setNextApt(next);
            setLoyalty(cards);
            setRecentBusinesses(recentList);
            setPendingClientCount(
              upcoming.filter((r) => r.status === 'pending').length
            );
          }
        }

        let pending = 0;
        if (pendingWave) {
          const [countRes, pendingRowsRes] = await pendingWave;
          if (countRes.error) {
            console.warn('pending count failed', countRes.error.message);
          } else {
            pending = countRes.count ?? 0;
          }
          // Marchează cererile existente ca „văzute" — popup doar pentru cele noi.
          for (const r of (pendingRowsRes.data ?? []) as { id: string }[]) {
            seenPendingRef.current.add(r.id);
          }
        }

        if (!cancelled) {
          setModeState(appMode);
          setCanSwitch(switchable);
          setBusiness(data as Biz | null);
          setPendingCount(pending);
          hasLoadedOnceRef.current = true;
          setLoading(false);
          markNavReady('home', {
            hasExistingData,
            softRefresh: hasExistingData && !measureBeforeEnabled(),
          });
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // Popup in notification bar for business — also when on Home, not only Cereri.
  // Fresh channel each mount: supabase.channel(sameName) reuses a subscribed
  // channel after tab remount (Cereri → Acasă), and .on() after subscribe() throws.
  useEffect(() => {
    const bizId = business?.id;
    const filter = bizId ? businessIdFilter([bizId]) : null;
    if (!bizId || !filter || mode !== 'business') return;

    const topic = `biz-home-${bizId}`;
    for (const ch of supabase.getChannels()) {
      if (ch.topic === `realtime:${topic}` || ch.topic === topic) {
        void supabase.removeChannel(ch);
      }
    }

    const channel = supabase.channel(`${topic}-${Date.now()}`);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'appointments', filter },
      (payload) => {
        const row = payload.new as
          | {
              id?: string;
              business_id?: string;
              status?: string;
              client_email?: string | null;
              client_phone?: string | null;
              guest_name?: string | null;
            }
          | null;
        if (!row?.id || row.business_id !== businessIdRef.current) return;
        if ((row.status ?? 'pending') !== 'pending') return;
        if (seenPendingRef.current.has(row.id)) return;
        seenPendingRef.current.add(row.id);
        setPendingCount((c) => c + 1);
        const contact = appointmentContactParts(row).join(' · ') || trKey('home.newClient');
        void presentLocalBookingNotification({
          title: trKey('notif.newBookingTitle'),
          body: trKey('home.pendingPushBody', { contact }),
          appointmentId: row.id,
          businessId: row.business_id,
        });
      }
    );
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [business?.id, mode]);

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <SkeletonScreen blocks={4} label={tr('home.loadingAgenda')} />
      </View>
    );
  }

  // Business primary menus live under business/(tabs) — keep /(app)/home for clients.
  if (mode === 'business' && !inBusinessTabs) {
    return <Redirect href="/(app)/business/(tabs)" />;
  }

  // Zona client are bara ei de meniu: nu se randează niciodată în interiorul tab-urilor business.
  if (mode === 'client' && inBusinessTabs) {
    return <Redirect href="/(app)/home" />;
  }

  if (mode === 'client') {
    return (
      <ClientHome
        canSwitch={canSwitch}
        next={nextApt}
        loyalty={loyalty}
        recentBusinesses={recentBusinesses}
        bottomInset={insets.bottom + spacing['3xl'] + 56}
        favoriteIds={favoriteIds}
        pendingClientCount={pendingClientCount}
        loadError={loadError}
        onToggleFavorite={(id) => void toggleFavorite(id)}
        onAttendanceConfirmed={() =>
          setNextApt((prev) =>
            prev ? { ...prev, attendanceConfirmed: true } : null
          )
        }
      />
    );
  }

  return (
    <BusinessHome
      email={email}
      business={business}
      canSwitch={canSwitch}
      pendingCount={pendingCount}
      bottomInset={inBusinessTabs ? spacing['3xl'] : insets.bottom + spacing['3xl'] + 56}
    />
  );
}

function openBook(biz: {
  publicCode: string;
  lastServiceId?: string | null;
  lastStaffId?: string | null;
}) {
  const parts: string[] = [];
  if (biz.lastServiceId) parts.push(`serviceId=${encodeURIComponent(biz.lastServiceId)}`);
  if (biz.lastStaffId) parts.push(`staffId=${encodeURIComponent(biz.lastStaffId)}`);
  const qs = parts.join('&');
  router.push((`/(app)/book/${biz.publicCode}` + (qs ? `?${qs}` : '')) as never);
}

function ClientHome({
  canSwitch,
  next,
  loyalty,
  recentBusinesses,
  bottomInset,
  favoriteIds,
  pendingClientCount,
  loadError,
  onToggleFavorite,
  onAttendanceConfirmed,
}: {
  canSwitch: boolean;
  next: NextAppointment | null;
  loyalty: LoyaltyCard[];
  recentBusinesses: RecentBusiness[];
  bottomInset: number;
  favoriteIds: string[];
  pendingClientCount: number;
  loadError: string | null;
  onToggleFavorite: (businessId: string) => void;
  onAttendanceConfirmed: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const nextLocation: BusinessLocation | null = next
    ? {
        county: next.county,
        city: next.city,
        address: next.address,
        mapsUrl: next.mapsUrl,
        latitude: next.latitude,
        longitude: next.longitude,
      }
    : null;
  const canDriveNext =
    Boolean(nextLocation && next?.status === 'approved' && hasLocation(nextLocation));

  function openByCode() {
    setCodeError(null);
    const extracted = extractPublicCode(code.trim());
    if (!extracted) {
      setCodeError(tr('home.enterCode'));
      return;
    }
    router.push(`/(app)/book/${extracted}` as never);
  }

  async function confirmAttendanceInline() {
    if (!next) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const { error: err } = await supabase.rpc('confirm_attendance', {
      p_appointment_id: next.id,
    });
    setConfirmBusy(false);
    if (err) {
      setConfirmError(mapBookingRpcError(err.message));
      return;
    }
    onAttendanceConfirmed();
  }

  const nextStatus = next ? statusMeta(next.status) : null;

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
    <Screen bottomInset={bottomInset}>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: t.colors.textMuted }]}>{tr('home.clientAccount')}</Text>
        <Text style={[styles.heroTitle, { color: t.colors.text }]} numberOfLines={1}>
          {tr('home.title')}
        </Text>
      </View>

      <UpdateBanner />

      <InvitationAcceptCard compact />

      {canSwitch ? <AppModeSwitch target="business" /> : null}

      {loadError ? <Callout tone="danger" title={loadError} /> : null}

      {next && nextStatus ? (
        <View
          style={[
            styles.nextCard,
            {
              backgroundColor: t.colors.surface,
              borderColor:
                next.status === 'approved' ? t.colors.warm : t.colors.border,
            },
            t.shadows.md,
          ]}
        >
          <View style={styles.nextHead}>
            <View
              style={[
                styles.nextIcon,
                {
                  backgroundColor:
                    next.status === 'approved' ? t.colors.warmSoft : t.colors.accentSoft,
                },
              ]}
            >
              <Ionicons
                name="calendar"
                size={20}
                color={
                  next.status === 'approved' ? t.colors.warmSoftText : t.colors.accentSoftText
                }
              />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.nextLabel, { color: t.colors.textMuted }]}>
                {tr('home.nextAppointment')}
              </Text>
              <Text style={[styles.nextBiz, { color: t.colors.text }]} numberOfLines={1}>
                {next.businessName}
              </Text>
            </View>
            <Badge tone={nextStatus.tone} icon={nextStatus.icon}>
              {nextStatus.label}
            </Badge>
          </View>

          <View>
            <Text style={[styles.nextWhen, { color: t.colors.text }]} numberOfLines={1}>
              {formatInTimeZone(new Date(next.start_at), next.timezone, 'dd.MM.yyyy · HH:mm')}
            </Text>
            <Text style={[styles.nextHint, { color: t.colors.textMuted }]} numberOfLines={1}>
              {tr('home.untilLocal', { time: formatInTimeZone(new Date(next.end_at), next.timezone, 'HH:mm') })}

            </Text>
            <Text style={[styles.nextHint, { color: t.colors.textMuted }]} numberOfLines={2}>
              {appointmentNextHint(next.status, {
                attendanceConfirmed: next.attendanceConfirmed,
              })}
            </Text>
          </View>

          {confirmError ? (
            <Body muted style={styles.codeError}>
              {confirmError}
            </Body>
          ) : null}

          <View style={styles.nextActions}>
            {canConfirmAttendance({ status: next.status, start_at: next.start_at, attendance_confirmed: next.attendanceConfirmed, no_show: false }) ? (
              <View style={styles.nextAction}>
                <Button
                  label={tr('appt.confirmAttendance')}
                  variant="success"
                  size="md"
                  icon="checkmark-circle-outline"
                  contentAlign="start"
                  labelNumberOfLines={1}
                  loading={confirmBusy}
                  onPress={() => void confirmAttendanceInline()}
                />
              </View>
            ) : null}
            {next.publicCode ? (
              <View style={styles.nextAction}>
                <Button
                  label={tr('home.bookAgain')}
                  variant="primary"
                  size="md"
                  icon="refresh-outline"
                  contentAlign="start"
                  labelNumberOfLines={1}
                  onPress={() => {
                    const parts: string[] = [];
                    if (next.serviceId) {
                      parts.push(`serviceId=${encodeURIComponent(next.serviceId)}`);
                    }
                    if (next.staffId) {
                      parts.push(`staffId=${encodeURIComponent(next.staffId)}`);
                    }
                    const qs = parts.join('&');
                    router.push(
                      (`/(app)/book/${next.publicCode}` + (qs ? `?${qs}` : '')) as never
                    );
                  }}
                />
              </View>
            ) : null}
            {canDriveNext && nextLocation ? (
              <View style={styles.nextAction}>
                <Button
                  label={tr('appt.driveNow')}
                  variant="secondary"
                  size="md"
                  icon="navigate-outline"
                  contentAlign="start"
                  labelNumberOfLines={1}
                  onPress={() => void openDriveChooser(nextLocation)}
                />
              </View>
            ) : null}
            <View style={styles.nextAction}>
              <Button
                label={tr('home.seeDetails')}
                variant="secondary"
                size="md"
                icon="arrow-forward"
                contentAlign="start"
                labelNumberOfLines={1}
                onPress={() => router.push('/(app)/my-appointments' as never)}
              />
            </View>
          </View>
        </View>
      ) : (
        <EmptyState
          icon="calendar-outline"
          title={tr('home.noUpcoming')}
          description={tr('home.noUpcomingDesc')}
        />
      )}

      <NearbyCarousel />

      <Banner
        tone="accent"
        icon="scan-outline"
        title={tr('home.bookSpot')}
        description={tr('home.bookSpotDesc')}
        actionLabel={tr('home.scanQr')}
        onPress={() => router.push('/(app)/scan')}
      />

      <Field
        label={tr('home.codeLabel')}
        icon="keypad-outline"
        placeholder={tr('home.codePlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setCodeError(null);
        }}
        onSubmitEditing={openByCode}
        returnKeyType="go"
      />
      {codeError ? (
        <Body muted style={styles.codeError}>
          {codeError}
        </Body>
      ) : null}
      <Button
        label={tr('home.openBooking')}
        icon="calendar-outline"
        onPress={openByCode}
        style={styles.codeSubmit}
      />

      {recentBusinesses.length > 0 ? (
        <>
          <SectionTitle>{tr('home.recentSalons')}</SectionTitle>
          {recentBusinesses.slice(0, 6).map((biz) => (
            <BizCardRow
              key={biz.id}
              title={biz.name}
              favorited={favoriteIds.includes(biz.id)}
              hint={[
                biz.lastServiceName,
                tr('home.lastVisit', {
                  date: formatInTimeZone(new Date(biz.lastVisitAt), biz.timezone, 'dd.MM.yyyy'),


                }),
                biz.city,
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => openBook(biz)}
              onToggleFavorite={() => onToggleFavorite(biz.id)}
            />
          ))}
        </>
      ) : null}

      {loyalty.length > 0 ? (
        <>
          <SectionTitle>{tr('home.loyalty')}</SectionTitle>
          {loyalty.map((card) => (
            <LoyaltyRow key={card.businessId} card={card} />
          ))}
        </>
      ) : null}
    </Screen>
    <ClientTabBar badges={{ appointments: pendingClientCount }} />
    </View>
  );
}

function BusinessHome({
  email,
  business,
  canSwitch,
  pendingCount,
  bottomInset,
}: {
  email: string | null;
  business: Biz | null;
  canSwitch: boolean;
  pendingCount: number;
  bottomInset: number;
}) {
  const t = useTheme();
  const tr = useT();
  const { role } = useBusinessRole();
  // Angajatul vede doar programările specialistului său: fără chat, listă de așteptare, echipă, servicii, setări.
  const isStaff = role === 'staff';
  // Necitite din chat (același cache partajat ca badge-ul clientului): la focus
  // și la 60 s cât ecranul e în focus și aplicația în prim-plan.
  const [chatUnread, setChatUnread] = useState(0);
  const [homeFocused, setHomeFocused] = useState(false);
  const refreshUnread = useCallback(() => {
    getUnreadTotal()
      .then((n) => setChatUnread(n))
      .catch(() => {});
  }, []);
  useFocusEffect(
    useCallback(() => {
      setHomeFocused(true);
      refreshUnread();
      return () => setHomeFocused(false);
    }, [refreshUnread])
  );
  useForegroundInterval(refreshUnread, 60_000, homeFocused);
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
    <Screen bottomInset={bottomInset}>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: t.colors.textMuted }]}>{tr('home.businessAccount')}</Text>
        <Text style={[styles.heroTitle, { color: t.colors.text }]} numberOfLines={1}>
          {tr('home.title')}
        </Text>
        {email ? (
          <View style={styles.accountRow}>
            <Avatar initials={email} size="sm" />
            <Text style={[styles.account, { color: t.colors.textMuted }]} numberOfLines={1}>
              {email}
            </Text>
          </View>
        ) : null}
      </View>

      <UpdateBanner />

      {!business ? (
        <>
          <InvitationAcceptCard compact />
          <Banner
            tone="accent"
            icon="rocket-outline"
            title={tr('home.setupTitle')}
            description={tr('home.setupDesc')}
            actionLabel={tr('home.setupCta')}
            onPress={() => router.push('/(app)/business/setup')}
          />
          <Guide />
        </>
      ) : (
        <>
          {isStaff ? <Callout tone="info">{tr('members.staffNote')}</Callout> : null}
          {canSwitch ? <AppModeSwitch target="client" /> : null}
          {pendingCount > 0 ? (
            <Banner
              tone="warm"
              icon="alert-circle-outline"
              title={pendingBannerTitle(pendingCount)}
              description={tr('home.decideBeforeExpire')}
              actionLabel={tr('home.seeRequests')}
              onPress={() => router.push('/(app)/business/(tabs)/requests')}
            />
          ) : null}

          <View
            style={[
              styles.bizCard,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              t.shadows.md,
            ]}
          >
            <View style={styles.bizHead}>
              <Avatar
                initials={business.name}
                imageUrl={business.logo_url}
                size="lg"
              />
              <View style={styles.flex}>
                <Text style={[styles.bizLabel, { color: t.colors.textMuted }]}>
                  {tr('home.yourBusiness')}
                </Text>
                <Text style={[styles.bizName, { color: t.colors.text }]} numberOfLines={1}>
                  {business.name}
                </Text>
              </View>
            </View>

            <View style={[styles.codeBox, { backgroundColor: t.colors.surfaceMuted }]}>
              <Text style={[styles.codeLabel, { color: t.colors.textMuted }]}>{tr('home.publicCode')}</Text>
              <Text style={[styles.code, { color: t.colors.text }]} selectable>
                {business.public_code}
              </Text>
            </View>

            <Button
              label={tr('home.qrShare')}
              icon="qr-code-outline"
              onPress={() => router.push('/(app)/business/qr')}
            />
          </View>
        </>
      )}

      <SectionTitle>{tr('home.title')}</SectionTitle>

      {isStaff ? null : (
      <Card
        icon='chatbubbles-outline'
        title={tr('home.cardMessages')}
        hint={tr('home.cardMessagesHint')}
        iconTone='neutral'
        chevron
        onPress={() => router.push('/(app)/business/chat' as never)}
      >
        {chatUnread > 0 ? (
          <View style={styles.unreadRow}>
            <Badge tone="danger" icon="mail-unread-outline">
              {tr('home.unreadMessages', { n: chatUnread })}
            </Badge>
          </View>
        ) : null}
      </Card>
      )}
      <Card
        icon="calendar-outline"
        title={tr('home.cardCalendar')}
        hint={tr('home.cardCalendarHint')}
        chevron
        onPress={() => router.push('/(app)/business/(tabs)/calendar' as never)}
      />
      {isStaff ? null : (
      <>
      <Card
        icon="notifications-outline"
        title={tr('home.cardWaitlist')}
        hint={tr('home.cardWaitlistHint')}
        chevron
        onPress={() => router.push('/(app)/business/waitlist' as never)}
      />

      <SectionTitle>{tr('home.clientsTeam')}</SectionTitle>

      
      <Card
        icon="people-circle-outline"
        title={tr('home.cardTeam')}
        hint={tr('home.cardTeamHint')}
        chevron
        onPress={() => router.push('/(app)/business/staff' as never)}
      />

      <SectionTitle>{tr('home.businessSection')}</SectionTitle>

      <Card
        icon="cut-outline"
        title={tr('home.cardServices')}
        hint={tr('home.cardServicesHint')}
        chevron
        onPress={() => router.push('/(app)/business/services' as never)}
      />
      
      <Card
        icon="star-outline"
        title={tr('rev.title')}
        hint={tr('rev.subtitle')}
        chevron
        onPress={() => router.push('/(app)/business/reviews' as never)}
      />
      <Card
        icon="settings-outline"
        title={tr('home.cardSetup')}
        hint={tr('home.cardSetupHint')}
        chevron
        onPress={() => router.push('/(app)/business/setup')}
      />
      </>
      )}

      <SectionTitle>{tr('home.asClient')}</SectionTitle>

      <Card
        icon="scan-outline"
        title={tr('home.cardBookAsClient')}
        hint={tr('home.cardBookAsClientHint')}
        chevron
        onPress={() => router.push('/(app)/scan')}
      />
      <Card
        icon="calendar-outline"
        title={tr('home.cardMyBookings')}
        hint={tr('home.cardMyBookingsHint')}
        chevron
        onPress={() => router.push('/(app)/my-appointments' as never)}
      />

      </Screen>
    </View>
  );
}

function LoyaltyRow({ card }: { card: LoyaltyCard }) {
  const t = useTheme();
  const tr = useT();
  const nextIsFree = card.untilFree === 1;
  const completed = card.every - card.untilFree;
  const progress = Math.min(1, Math.max(0, completed / card.every));

  return (
    <View
      style={[
        styles.loyaltyCard,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
      ]}
    >
      <View style={styles.loyaltyHead}>
        <View style={styles.flex}>
          <Text style={[styles.loyaltyBiz, { color: t.colors.text }]} numberOfLines={1}>
            {card.businessName}
          </Text>
          <Text style={[styles.loyaltyMeta, { color: t.colors.textMuted }]} numberOfLines={1}>
            {tr('home.loyaltyProgress', { done: completed, every: card.every, visits: card.visitCount })}
          </Text>
        </View>
        {nextIsFree ? (
          <Badge tone="success" icon="gift-outline">
            {tr('home.nextFree')}
          </Badge>
        ) : (
          <Badge tone="accent">
            {card.untilFree === 1
              ? tr('home.oneVisitGift')
              : tr('home.visitsGift', { n: card.untilFree })}
          </Badge>
        )}
      </View>

      <View style={[styles.loyaltyTrack, { backgroundColor: t.colors.surfaceMuted }]}>
        <View
          style={[
            styles.loyaltyFill,
            {
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: nextIsFree ? t.colors.success : t.colors.accent,
            },
          ]}
        />
      </View>
    </View>
  );
}

function Guide() {
  const t = useTheme();
  const tr = useT();
  return (
    <View
      style={[
        styles.guide,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        t.shadows.sm,
      ]}
    >
      <Text style={[styles.guideTitle, { color: t.colors.text }]}>
        {tr('home.guideTitle')}
      </Text>
      {GUIDE_STEPS.map((step, i) => (
        <View key={step} style={styles.guideStep}>
          <View style={[styles.guideNum, { backgroundColor: t.colors.accentSoft }]}>
            <Text style={[styles.guideNumText, { color: t.colors.accentSoftText }]}>
              {i + 1}
            </Text>
          </View>
          <Text style={[styles.guideText, { color: t.colors.textMuted }]}>{tr(step)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  unreadRow: { flexDirection: 'row', marginTop: spacing.xs },
  flex: { flex: 1, minWidth: 0 },
  hero: { gap: 4, marginBottom: spacing.sm },
  heroLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  heroTitle: { fontSize: fontSize['3xl'], fontWeight: '800', letterSpacing: -0.8 },
  accountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  account: { fontSize: fontSize.sm, flexShrink: 1 },
  codeError: { marginTop: -spacing.xs },
  codeSubmit: { marginBottom: spacing.sm },

  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  profileName: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1, minWidth: 0 },
  profileMeta: { fontSize: fontSize.sm, marginTop: 2 },

  nextCard: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  nextHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  nextIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  nextBiz: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.2, flexShrink: 1, minWidth: 0 },
  nextWhen: { fontSize: fontSize.xl, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1, minWidth: 0 },
  nextHint: { fontSize: fontSize.xs, marginTop: 2 },
  nextActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  nextAction: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '47%',
    minWidth: '47%',
    maxWidth: '48.5%',
  },

  loyaltyCard: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  loyaltyHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, flexWrap: 'wrap' },
  loyaltyBiz: { fontSize: fontSize.md, fontWeight: '700', flexShrink: 1, minWidth: 0 },
  loyaltyMeta: { fontSize: fontSize.sm, marginTop: 2 },
  loyaltyTrack: {
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  loyaltyFill: { height: '100%', borderRadius: radius.pill },

  bizCard: {
    padding: spacing.lg,
    gap: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bizHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bizIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizInitial: { fontSize: fontSize.xl, fontWeight: '800' },
  bizLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bizName: { fontSize: fontSize.xl, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1, minWidth: 0 },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  codeLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  code: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: 1 },

  guide: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
  },
  guideTitle: { fontSize: fontSize.md, fontWeight: '700' },
  guideStep: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  guideNum: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guideNumText: { fontSize: fontSize.xs, fontWeight: '800' },
  guideText: { flex: 1, minWidth: 0, fontSize: fontSize.sm, lineHeight: 19 },
});
