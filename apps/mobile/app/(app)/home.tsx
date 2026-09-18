import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Avatar,
  Badge,
  Banner,
  Body,
  Button,
  Card,
  Field,
  Screen,
  SectionTitle,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { resolveAppMode, type AppMode } from '@/lib/appMode';
import { visitsUntilFree } from '@/lib/bookingRules';
import { extractPublicCode } from '@/lib/bookingLink';
import {
  hasCoordinates,
  openDrive,
  type BusinessLocation,
} from '@/lib/location';
import { registerForPushAsync, presentLocalBookingNotification } from '@/lib/notifications';
import { formatPhoneDisplay } from '@/lib/phone';
import { STATUS_META } from '@/lib/status';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { AppointmentStatus } from '@/lib/types';

type Biz = { id: string; name: string; public_code: string };

type NextAppointment = {
  id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  businessName: string;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  county: string | null;
  city: string | null;
  address: string | null;
  mapsUrl: string | null;
};

type LoyaltyCard = {
  businessId: string;
  businessName: string;
  visitCount: number;
  every: number;
  untilFree: number;
};

type ClientProfile = {
  displayName: string | null;
  email: string | null;
  phone: string | null;
};

type RecentBusiness = {
  id: string;
  name: string;
  publicCode: string;
  timezone: string;
  lastVisitAt: string;
};

const GUIDE_STEPS = [
  'Configurează agenda (nume, program, servicii)',
  'Deschide QR-ul sau copiază linkul public',
  'Clienții rezervă din browser sau din app',
  '„Cereri” — aprobi sau respingi programarea',
];

function pendingBannerTitle(count: number): string {
  if (count === 1) return 'Ai 1 cerere în așteptare';
  return `Ai ${count} cereri în așteptare`;
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [mode, setModeState] = useState<AppMode>('client');
  const [email, setEmail] = useState<string | null>(null);
  const [business, setBusiness] = useState<Biz | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [nextApt, setNextApt] = useState<NextAppointment | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyCard[]>([]);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [recentBusinesses, setRecentBusinesses] = useState<RecentBusiness[]>([]);
  // Id-uri pending deja văzute — popup în bara de notificări doar la cereri NOI.
  const seenPendingRef = useRef<Set<string>>(new Set());
  const businessIdRef = useRef<string | null>(null);
  businessIdRef.current = business?.id ?? null;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoading(true);
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || cancelled) {
          if (!cancelled) setLoading(false);
          return;
        }
        setEmail(user.email ?? null);

        await supabase.from('profiles').upsert(
          {
            id: user.id,
            email: user.email ?? null,
            phone: user.phone ?? null,
          },
          { onConflict: 'id' }
        );

        try {
          await registerForPushAsync(user.id);
        } catch (e) {
          console.warn('Push register on home failed', e);
        }

        const appMode = await resolveAppMode(user.id);

        const { data } = await supabase
          .from('business_profiles')
          .select('id, name, public_code')
          .eq('owner_user_id', user.id)
          .maybeSingle();

        let pending = 0;
        if (data?.id) {
          const { count, error: cErr } = await supabase
            .from('appointments')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', data.id)
            .eq('status', 'pending');
          if (cErr) {
            console.warn('pending count failed', cErr.message);
          } else {
            pending = count ?? 0;
          }
          // Marchează cererile existente ca „văzute" — popup doar pentru cele noi.
          const { data: pendingRows } = await supabase
            .from('appointments')
            .select('id')
            .eq('business_id', data.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(50);
          for (const r of (pendingRows ?? []) as { id: string }[]) {
            seenPendingRef.current.add(r.id);
          }
        }

        if (appMode === 'client') {
          const { data: profile } = await supabase
            .from('profiles')
            .select('email, phone, display_name')
            .eq('id', user.id)
            .maybeSingle();

          if (!cancelled) {
            setClientProfile({
              displayName: profile?.display_name ?? null,
              email: profile?.email ?? null,
              phone: profile?.phone ?? null,
            });
          }

          const orParts: string[] = [];
          if (profile?.email) orParts.push(`client_email.eq.${profile.email}`);
          if (profile?.phone) orParts.push(`client_phone.eq.${profile.phone}`);

          const myOrFilter = orParts.length ? orParts.join(',') : null;
          const cols = 'id, business_id, start_at, end_at, status, client_user_id, no_show';
          const { data: aptRows } = myOrFilter
            ? await supabase
                .from('appointments')
                .select(cols)
                .or(`client_user_id.eq.${user.id},${myOrFilter}`)
                .order('start_at', { ascending: true })
            : await supabase
                .from('appointments')
                .select(cols)
                .eq('client_user_id', user.id)
                .order('start_at', { ascending: true });

          const rows = (aptRows ?? []) as {
            id: string;
            business_id: string;
            start_at: string;
            end_at: string;
            status: AppointmentStatus;
            no_show: boolean | null;
          }[];

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
          if (bizIds.length) {
            const { data: bizRows } = await supabase
              .from('business_profiles')
              .select(
                'id, name, timezone, loyalty_every, public_code, latitude, longitude, county, city, address, maps_url'
              )
              .in('id', bizIds);
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

          const recentMap = new Map<string, string>();
          for (const r of rows) {
            const prev = recentMap.get(r.business_id);
            if (!prev || new Date(r.start_at).getTime() > new Date(prev).getTime()) {
              recentMap.set(r.business_id, r.start_at);
            }
          }
          const recentList: RecentBusiness[] = [];
          for (const [bizId, lastAt] of recentMap) {
            const biz = bizById[bizId];
            if (!biz?.public_code) continue;
            recentList.push({
              id: bizId,
              name: biz.name,
              publicCode: biz.public_code,
              timezone: biz.timezone,
              lastVisitAt: lastAt,
            });
          }
          recentList.sort(
            (a, b) => new Date(b.lastVisitAt).getTime() - new Date(a.lastVisitAt).getTime()
          );

          const now = Date.now();
          const upcoming = rows
            .filter(
              (r) =>
                (r.status === 'pending' || r.status === 'approved') &&
                new Date(r.start_at).getTime() >= now
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
              businessName: biz?.name ?? 'Business',
              timezone: biz?.timezone ?? 'Europe/Bucharest',
              latitude: biz?.latitude ?? null,
              longitude: biz?.longitude ?? null,
              county: biz?.county ?? null,
              city: biz?.city ?? null,
              address: biz?.address ?? null,
              mapsUrl: biz?.maps_url ?? null,
            };
          }

          const cards: LoyaltyCard[] = [];
          for (const bizId of bizIds) {
            const biz = bizById[bizId];
            if (!biz || !biz.loyalty_every || biz.loyalty_every < 2) continue;
            const visits = rows.filter(
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
          }
        }

        if (!cancelled) {
          setModeState(appMode);
          setBusiness(data as Biz | null);
          setPendingCount(pending);
          setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  // Popup în bara de notificări pentru business — merge și când ești pe Home,
  // nu doar pe ecranul Cereri. Fallback local dacă push-ul remote nu ajunge.
  useEffect(() => {
    const bizId = business?.id;
    if (!bizId || mode !== 'business') return;
    const channel = supabase
      .channel(`biz-home-${bizId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'appointments' },
        (payload) => {
          const row = payload.new as
            | {
                id?: string;
                business_id?: string;
                status?: string;
                client_email?: string | null;
                client_phone?: string | null;
              }
            | null;
          if (!row?.id || row.business_id !== businessIdRef.current) return;
          if ((row.status ?? 'pending') !== 'pending') return;
          if (seenPendingRef.current.has(row.id)) return;
          seenPendingRef.current.add(row.id);
          setPendingCount((c) => c + 1);
          const contact = row.client_email || row.client_phone || 'Client nou';
          void presentLocalBookingNotification({
            title: 'Cerere nouă de programare',
            body: `Ai o cerere de la ${contact}. Deschide Cereri pentru a răspunde.`,
            appointmentId: row.id,
            businessId: row.business_id,
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [business?.id, mode]);

  if (loading) {
    return <SkeletonScreen blocks={4} label="Se încarcă agenda…" />;
  }

  if (mode === 'client') {
    return (
      <ClientHome
        email={email}
        profile={clientProfile}
        next={nextApt}
        loyalty={loyalty}
        recentBusinesses={recentBusinesses}
        bottomInset={insets.bottom + spacing['3xl']}
      />
    );
  }

  return (
    <BusinessHome
      email={email}
      business={business}
      pendingCount={pendingCount}
      bottomInset={insets.bottom + spacing['3xl']}
    />
  );
}

function ClientHome({
  email,
  profile,
  next,
  loyalty,
  recentBusinesses,
  bottomInset,
}: {
  email: string | null;
  profile: ClientProfile | null;
  next: NextAppointment | null;
  loyalty: LoyaltyCard[];
  recentBusinesses: RecentBusiness[];
  bottomInset: number;
}) {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
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
  const canDriveNext = nextLocation ? hasCoordinates(nextLocation) : false;

  function openByCode() {
    setCodeError(null);
    const extracted = extractPublicCode(code.trim());
    if (!extracted) {
      setCodeError('Introdu codul sau linkul de rezervare al business-ului.');
      return;
    }
    router.push(`/(app)/book/${extracted}` as never);
  }

  const nextStatus = next ? STATUS_META[next.status] : null;

  return (
    <Screen bottomInset={bottomInset}>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: t.colors.textMuted }]}>Cont client</Text>
        <Text style={[styles.heroTitle, { color: t.colors.text }]} numberOfLines={1}>
          Programări
        </Text>
      </View>

      <View
        style={[
          styles.profileCard,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          t.shadows.sm,
        ]}
      >
        <Avatar
          initials={profile?.displayName ?? profile?.email ?? email ?? '?'}
          size="lg"
        />
        <View style={styles.flex}>
          <Text style={[styles.profileName, { color: t.colors.text }]} numberOfLines={1}>
            {profile?.displayName ?? profile?.email ?? email ?? 'Cont client'}
          </Text>
          <Text style={[styles.profileMeta, { color: t.colors.textMuted }]} numberOfLines={1}>
            {profile?.phone
              ? formatPhoneDisplay(profile.phone)
              : 'Fără telefon — adaugă-l din Setări pentru WhatsApp'}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/(app)/settings' as never)}
          accessibilityRole="button"
          accessibilityLabel="Deschide setările contului"
          hitSlop={6}
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="create-outline" size={20} color={t.colors.textFaint} />
        </Pressable>
      </View>

      {next && nextStatus ? (
        <View
          style={[
            styles.nextCard,
            { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            t.shadows.md,
          ]}
        >
          <View style={styles.nextHead}>
            <View style={[styles.nextIcon, { backgroundColor: t.colors.accentSoft }]}>
              <Ionicons name="calendar" size={20} color={t.colors.accentSoftText} />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.nextLabel, { color: t.colors.textMuted }]}>
                Următoarea programare
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
            <Text style={[styles.nextWhen, { color: t.colors.text }]}>
              {formatInTimeZone(new Date(next.start_at), next.timezone, 'dd.MM.yyyy · HH:mm')}
            </Text>
            <Text style={[styles.nextHint, { color: t.colors.textMuted }]}>
              până la {formatInTimeZone(new Date(next.end_at), next.timezone, 'HH:mm')} · ora
              locală a business-ului
            </Text>
          </View>

          <View style={styles.nextActions}>
            {canDriveNext && nextLocation ? (
              <View style={styles.nextAction}>
                <Button
                  label="Condu acum"
                  variant="primary"
                  size="md"
                  icon="navigate-outline"
                  onPress={() => void openDrive(nextLocation)}
                />
              </View>
            ) : null}
            <View style={styles.nextAction}>
              <Button
                label="Vezi detalii"
                variant="secondary"
                size="md"
                icon="arrow-forward"
                onPress={() => router.push('/(app)/my-appointments' as never)}
              />
            </View>
          </View>
        </View>
      ) : null}

      <Banner
        tone="accent"
        icon="scan-outline"
        title="Rezervă un loc"
        description="Scanează QR-ul de la salon sau introdu codul public."
        actionLabel="Scanează QR"
        onPress={() => router.push('/(app)/scan')}
      />

      <Field
        label="Cod sau link de rezervare"
        icon="keypad-outline"
        placeholder="ex. salon12 sau link /b/…"
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
        label="Deschide programarea"
        icon="calendar-outline"
        onPress={openByCode}
        style={styles.codeSubmit}
      />

      {recentBusinesses.length > 0 ? (
        <>
          <SectionTitle>Rezervă din nou</SectionTitle>
          {recentBusinesses.slice(0, 4).map((biz) => (
            <Card
              key={biz.id}
              icon="storefront-outline"
              title={biz.name}
              hint={`Ultima programare: ${formatInTimeZone(
                new Date(biz.lastVisitAt),
                biz.timezone,
                'dd.MM.yyyy'
              )}`}
              chevron
              onPress={() => router.push(`/(app)/book/${biz.publicCode}` as never)}
            />
          ))}
        </>
      ) : null}

      {loyalty.length > 0 ? (
        <>
          <SectionTitle>Fidelitate</SectionTitle>
          {loyalty.map((card) => (
            <LoyaltyRow key={card.businessId} card={card} />
          ))}
        </>
      ) : null}

      <SectionTitle>Contul tău</SectionTitle>
      <Card
        icon="calendar-outline"
        title="Programările mele"
        hint="Status: în așteptare, confirmat, respins"
        iconTone="success"
        chevron
        onPress={() => router.push('/(app)/my-appointments')}
      />
      <Card
        icon="person-circle-outline"
        title="Setări"
        hint="Profil, WhatsApp, notificări, deconectare"
        iconTone="neutral"
        chevron
        onPress={() => router.push('/(app)/settings')}
      />
    </Screen>
  );
}

function BusinessHome({
  email,
  business,
  pendingCount,
  bottomInset,
}: {
  email: string | null;
  business: Biz | null;
  pendingCount: number;
  bottomInset: number;
}) {
  const t = useTheme();
  return (
    <Screen bottomInset={bottomInset}>
      <View style={styles.hero}>
        <Text style={[styles.heroLabel, { color: t.colors.textMuted }]}>Cont business</Text>
        <Text style={[styles.heroTitle, { color: t.colors.text }]} numberOfLines={1}>
          Programări
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

      {!business ? (
        <>
          <Banner
            tone="accent"
            icon="rocket-outline"
            title="Începe prin a-ți configura agenda"
            description="Timezone, durată ședință, program de lucru și pauză — apoi primești un cod QR."
            actionLabel="Configurează"
            onPress={() => router.push('/(app)/business/setup')}
          />
          <Guide />
        </>
      ) : (
        <>
          {pendingCount > 0 ? (
            <Banner
              tone="warning"
              icon="alert-circle-outline"
              title={pendingBannerTitle(pendingCount)}
              description="Aprobă sau respinge cererile înainte să expire."
              actionLabel="Vezi cererile"
              onPress={() => router.push('/(app)/business/requests')}
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
              <View style={[styles.bizIcon, { backgroundColor: t.colors.accentSoft }]}>
                <Text style={[styles.bizInitial, { color: t.colors.accentSoftText }]}>
                  {business.name.slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text style={[styles.bizLabel, { color: t.colors.textMuted }]}>
                  Business-ul tău
                </Text>
                <Text style={[styles.bizName, { color: t.colors.text }]} numberOfLines={1}>
                  {business.name}
                </Text>
              </View>
            </View>

            <View style={[styles.codeBox, { backgroundColor: t.colors.surfaceMuted }]}>
              <Text style={[styles.codeLabel, { color: t.colors.textMuted }]}>Cod public</Text>
              <Text style={[styles.code, { color: t.colors.text }]} selectable>
                {business.public_code}
              </Text>
            </View>

            <Button
              label="Vezi QR / partajează"
              icon="qr-code-outline"
              onPress={() => router.push('/(app)/business/qr')}
            />
          </View>
        </>
      )}

      <SectionTitle>Programări</SectionTitle>

      <Card
        icon="hourglass-outline"
        title="Cereri programări"
        hint={
          pendingCount > 0
            ? pendingBannerTitle(pendingCount)
            : 'Aprobă sau respinge cererile în așteptare'
        }
        iconTone="warning"
        chevron
        onPress={() => router.push('/(app)/business/requests')}
      />
      <Card
        icon="calendar-outline"
        title="Calendar pe zi"
        hint="Programări pe ore, blochează concediul"
        chevron
        onPress={() => router.push('/(app)/business/calendar' as never)}
      />
      <Card
        icon="notifications-outline"
        title="Listă de așteptare"
        hint="Clienți anunțați când se eliberează un loc"
        chevron
        onPress={() => router.push('/(app)/business/waitlist' as never)}
      />

      <SectionTitle>Clienți și echipă</SectionTitle>

      <Card
        icon="people-outline"
        title="Clienți"
        hint="Istoric, vizite, note interne"
        chevron
        onPress={() => router.push('/(app)/business/clients' as never)}
      />
      <Card
        icon="people-circle-outline"
        title="Echipă"
        hint="Specialiști și program propriu"
        chevron
        onPress={() => router.push('/(app)/business/staff' as never)}
      />

      <SectionTitle>Business</SectionTitle>

      <Card
        icon="cut-outline"
        title="Servicii"
        hint="Nume, durată, preț"
        chevron
        onPress={() => router.push('/(app)/business/services' as never)}
      />
      <Card
        icon="stats-chart-outline"
        title="Rapoarte"
        hint="Venit, no-show, top servicii"
        chevron
        onPress={() => router.push('/(app)/business/reports' as never)}
      />
      <Card
        icon="qr-code-outline"
        title="Cod QR business"
        hint="Arată sau partajează linkul de rezervare"
        chevron
        onPress={() => router.push('/(app)/business/qr')}
      />
      <Card
        icon="settings-outline"
        title="Configurare business"
        hint="Nume, program, reguli, zile blocate"
        chevron
        onPress={() => router.push('/(app)/business/setup')}
      />

      <SectionTitle>Cont</SectionTitle>

      <Card
        icon="person-circle-outline"
        title="Setări"
        hint="Profil, WhatsApp, notificări push, deconectare"
        iconTone="neutral"
        chevron
        onPress={() => router.push('/(app)/settings')}
      />
    </Screen>
  );
}

function LoyaltyRow({ card }: { card: LoyaltyCard }) {
  const t = useTheme();
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
          <Text style={[styles.loyaltyMeta, { color: t.colors.textMuted }]}>
            {card.visitCount} vizite · cadou la fiecare {card.every}
          </Text>
        </View>
        {nextIsFree ? (
          <Badge tone="success" icon="gift-outline">
            Următoarea e gratuită
          </Badge>
        ) : (
          <Badge tone="accent">
            {card.untilFree === 1
              ? '1 vizită până la cadou'
              : `${card.untilFree} vizite până la cadou`}
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
  return (
    <View
      style={[
        styles.guide,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        t.shadows.sm,
      ]}
    >
      <Text style={[styles.guideTitle, { color: t.colors.text }]}>
        Cum începi ca business
      </Text>
      {GUIDE_STEPS.map((step, i) => (
        <View key={step} style={styles.guideStep}>
          <View style={[styles.guideNum, { backgroundColor: t.colors.accentSoft }]}>
            <Text style={[styles.guideNumText, { color: t.colors.accentSoftText }]}>
              {i + 1}
            </Text>
          </View>
          <Text style={[styles.guideText, { color: t.colors.textMuted }]}>{step}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
  profileName: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.3 },
  profileMeta: { fontSize: fontSize.sm, marginTop: 2 },

  nextCard: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  nextHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
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
  nextBiz: { fontSize: fontSize.lg, fontWeight: '800', letterSpacing: -0.2 },
  nextWhen: { fontSize: fontSize.xl, fontWeight: '800', letterSpacing: -0.3 },
  nextHint: { fontSize: fontSize.xs, marginTop: 2 },
  nextActions: { flexDirection: 'row', gap: spacing.sm },
  nextAction: { flex: 1 },

  loyaltyCard: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  loyaltyHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  loyaltyBiz: { fontSize: fontSize.md, fontWeight: '700' },
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
  bizName: { fontSize: fontSize.xl, fontWeight: '800', letterSpacing: -0.3 },
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
  guideText: { flex: 1, fontSize: fontSize.sm, lineHeight: 19 },
});
