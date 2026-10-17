import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
import { ClientTabBar } from '@/components/ClientTabBar';
import {
  Button,
  Callout,
  EmptyState,
  Field,
  ListLoadingScreen,
  Screen,
  Segmented,
  useTheme,
} from '@/components/ui';
import { spacing } from '@/constants/theme';
import {
  canClientCancel,
  canClientReschedule,
  canConfirmAttendance,
  canReview,
  mapBookingRpcError,
} from '@/lib/bookingRules';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { addAppointmentToCalendar } from '@/lib/ics';
import {
  formatAddress,
  hasLocation,
  locationFromBusiness,
  openDriveChooser,
} from '@/lib/location';
import { useBack } from '@/lib/nav';
import { invokeWaitlistNotify } from '@/lib/notify-client';
import { invokeRefundDeposit } from '@/lib/payments';
import { formatRon } from '@/lib/format';
import { sessionsLeft } from '@/lib/packages';
import { canCheckIn } from '@/lib/checkin';
import { makeReferralCode } from '@/lib/referral';
import { getPublicWebOrigin } from '@/lib/webBase';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile, Review } from '@/lib/types';
import { trKey, useT } from '@/lib/i18n';

type Row = Appointment & {
  business_profiles?: Pick<
    BusinessProfile,
    | 'name'
    | 'timezone'
    | 'public_code'
    | 'cancel_notice_minutes'
    | 'county'
    | 'city'
    | 'address'
    | 'maps_url'
    | 'google_review_url'
    | 'latitude'
    | 'longitude'
  > | null;
};

type Filter = 'all' | 'upcoming' | 'past';

export default function MyAppointmentsScreen() {
  const tr = useT();
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [reviewsByApt, setReviewsByApt] = useState<Record<string, Review>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [myWaitlist, setMyWaitlist] = useState<Array<{ id: string; desired_date: string; status: string; business_id: string }>>([]);
  const [myPackages, setMyPackages] = useState<
    Array<{
      id: string;
      sessions_total: number;
      sessions_used: number;
      packages?: { name: string | null } | null;
      business_profiles?: { name: string | null } | null;
    }>
  >([]);
  const [giftCode, setGiftCode] = useState('');
  const [giftResult, setGiftResult] = useState<string | null>(null);
  const [myReferralCode, setMyReferralCode] = useState<string | null>(null);
  const [myReferrals, setMyReferrals] = useState<
    Array<{ id: string; status: string; created_at: string }>
  >([]);

  // Doar ultimul load() scrie lista: un raspuns vechi nu mai suprascrie starea noua.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError(trKey('auth.notSignedIn'));
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('email, phone')
      .eq('id', user.id)
      .maybeSingle();

    const { data: byUser, error: err } = await supabase
      .from('appointments')
      .select('*')
      .eq('client_user_id', user.id)
      .order('start_at', { ascending: false });

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    let extras: Appointment[] = [];
    const orParts: string[] = [];
    if (profile?.email) orParts.push(`client_email.eq.${profile.email}`);
    if (profile?.phone) orParts.push(`client_phone.eq.${profile.phone}`);
    if (orParts.length) {
      const extra = await supabase
        .from('appointments')
        .select('*')
        .or(orParts.join(','))
        .order('start_at', { ascending: false });
      if (!extra.error) extras = (extra.data ?? []) as Appointment[];
    }

    const merged = new Map<string, Appointment>();
    for (const row of [...((byUser ?? []) as Appointment[]), ...extras]) {
      merged.set(row.id, row);
    }
    const list = Array.from(merged.values()).sort(
      (a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime()
    );

    const bizIds = [...new Set(list.map((a) => a.business_id))];
    let bizById: Record<string, Row['business_profiles']> = {};
    if (bizIds.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let bizRes: any = await supabase
        .from('business_profiles')
        .select(
          'id, name, timezone, public_code, cancel_notice_minutes, county, city, address, maps_url, google_review_url, latitude, longitude'
        )
        .in('id', bizIds);
      if (bizRes.error && /google_review_url/i.test(bizRes.error.message)) {
        bizRes = await supabase
          .from('business_profiles')
          .select(
            'id, name, timezone, public_code, cancel_notice_minutes, county, city, address, maps_url, latitude, longitude'
          )
          .in('id', bizIds);
      }
      const businesses = bizRes.data;
      for (const b of businesses ?? []) {
        bizById[b.id] = {
          name: b.name,
          timezone: b.timezone,
          public_code: b.public_code,
          cancel_notice_minutes: b.cancel_notice_minutes,
          county: b.county,
          city: b.city,
          address: b.address,
          maps_url: b.maps_url,
          google_review_url: b.google_review_url,
          latitude: b.latitude,
          longitude: b.longitude,
        };
      }
    }

    if (seq !== loadSeq.current) return;
    setRows(
      list.map((a) => ({
        ...a,
        business_profiles: bizById[a.business_id] ?? null,
      }))
    );
    const aptIds = list.map((a) => a.id);
    const map: Record<string, Review> = {};
    if (aptIds.length) {
      const { data: revs } = await supabase
        .from('reviews')
        .select(
          'id, business_id, appointment_id, client_user_id, staff_id, rating, comment, created_at'
        )
        .in('appointment_id', aptIds);
      for (const r of (revs ?? []) as Review[]) map[r.appointment_id] = r;
    }
    const { data: wl } = await supabase
      .from('waitlist')
      .select('id, desired_date, status, business_id')
      .eq('client_user_id', user.id)
      .in('status', ['active', 'notified'])
      .order('desired_date', { ascending: true });
    setMyWaitlist((wl ?? []) as Array<{ id: string; desired_date: string; status: string; business_id: string }>);
    const { data: pkgs } = await supabase
      .from('client_packages')
      .select('id, sessions_total, sessions_used, packages(name), business_profiles(name)')
      .eq('client_user_id', user.id)
      .order('created_at', { ascending: false });
    setMyPackages((pkgs ?? []) as unknown as typeof myPackages);
    const { data: me } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', user.id)
      .maybeSingle();
    let code = (me?.referral_code as string | null) ?? null;
    if (!code) {
      code = makeReferralCode();
      await supabase.from('profiles').update({ referral_code: code }).eq('id', user.id);
    }
    setMyReferralCode(code);
    const { data: refs } = await supabase
      .from('referrals')
      .select('id, status, created_at')
      .eq('referrer_user_id', user.id)
      .order('created_at', { ascending: false });
    setMyReferrals((refs ?? []) as typeof myReferrals);
    setReviewsByApt(map);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load])
  );

  function localLabel(a: Row): string {
    const tz = a.business_profiles?.timezone ?? 'Europe/Bucharest';
    const start = formatInTimeZone(new Date(a.start_at), tz, 'dd.MM.yyyy HH:mm');
    const end = formatInTimeZone(new Date(a.end_at), tz, 'HH:mm');
    return `${start} – ${end}`;
  }

  async function leaveMyWaitlist(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('leave_waitlist', { p_waitlist_id: id });
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    await load();
  }
  const [checkInBusyId, setCheckInBusyId] = useState<string | null>(null);

  async function handleCheckIn(item: Row) {
    setCheckInBusyId(item.id);
    setError(null);
    const { error: err } = await supabase.rpc('mark_checked_in', {
      p_appointment_id: item.id,
    });
    setCheckInBusyId(null);
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    await load();
  }

  async function checkGiftCard() {
    setGiftResult(null);
    const { data, error: err } = await supabase.rpc('check_gift_card', {
      p_code: giftCode.trim(),
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (err || !row) {
      setGiftResult(trKey('pkg.giftNotFound'));
      return;
    }
    const statusLabel =
      row.status === 'redeemed'
        ? trKey('pkg.giftStatusRedeemed')
        : row.status === 'cancelled'
          ? trKey('pkg.giftStatusCancelled')
          : trKey('pkg.giftStatusActive');
    setGiftResult(
      trKey('pkg.giftFound', {
        business: row.business_name ?? '',
        balance: formatRon(row.balance),
        status: statusLabel,
      })
    );
  }

  async function cancelSeries(item: Row) {
    if (!item.recurring_series_id) return;
    setError(null);
    setSuccess(null);
    const { data, error: err } = await supabase.rpc('cancel_recurring_series', {
      p_series_id: item.recurring_series_id,
    });
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    // Actualizare imediata a listei, apoi reincarcare de la server.
    setRows((prev) =>
      prev.map((r) =>
        r.recurring_series_id === item.recurring_series_id && (r.status === 'pending' || r.status === 'approved')
          ? { ...r, status: 'cancelled' }
          : r
      )
    );
    setSuccess(trKey('appt.seriesCancelled', { count: Number(data ?? 0) }));
    await load();
  }
  async function cancelAppointment(item: Row) {
    setError(null);
    const { error: err } = await supabase.rpc('cancel_appointment', {
      p_appointment_id: item.id,
    });
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    setRows((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: 'cancelled' } : r)));
    if (item.payment_status === 'paid') {
      void invokeRefundDeposit(item.id);
    }
    const tz = item.business_profiles?.timezone ?? 'Europe/Bucharest';
    const desiredDate = formatInTimeZone(new Date(item.start_at), tz, 'yyyy-MM-dd');
    const code = item.business_profiles?.public_code;
    void invokeWaitlistNotify({
      business_id: item.business_id,
      desired_date: desiredDate,
      booking_url: code ? getWebBookingUrl(code) : '',
    });
    await load();
  }

  async function confirmAttendance(id: string) {
    setError(null);
    const { error: err } = await supabase.rpc('confirm_attendance', {
      p_appointment_id: id,
    });
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    await load();
  }


  async function saveReview() {
    if (!reviewingId) return;
    setError(null);
    const { error: err } = await supabase.rpc('submit_review', {
      p_appointment_id: reviewingId,
      p_rating: reviewRating,
      p_comment: reviewComment.trim(),
    });
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
    setReviewingId(null);
    setReviewComment('');
    await load();
  }

  const shown = useMemo(() => {
    const now = Date.now();
    if (filter === 'upcoming') {
      return rows.filter((r) => new Date(r.end_at).getTime() >= now);
    }
    if (filter === 'past') {
      return rows.filter((r) => new Date(r.end_at).getTime() < now);
    }
    return rows;
  }, [rows, filter]);

  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title={tr('home.cardMyBookings')}
        subtitle={tr('my.subtitle')}
        onBack={back}
        label={tr('my.loading')}
      />
    );
  }

  const pendingCount = rows.filter((r) => r.status === 'pending').length;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
    <Screen title={tr('home.cardMyBookings')} subtitle={tr('my.subtitle')} onBack={back} scroll={false}>
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={t.colors.accent}
            colors={[t.colors.accent]}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: tr('my.all') },
                { value: 'upcoming', label: tr('my.upcoming') },
                { value: 'past', label: tr('my.past') },
              ]}
            />
            {error ? (
              <Callout tone="danger" title={tr('chat.errorTitle')}>
                {error}
              </Callout>
            ) : null}
            {success ? (
              <Callout tone="success">
                {success}
              </Callout>
            ) : null}
            {myWaitlist.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ fontWeight: '800', color: t.colors.text }}>{tr('wl.myTitle')}</Text>
                {myWaitlist.map((w) => (
                  <View
                    key={w.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.sm,
                      borderWidth: 1,
                      borderColor: t.colors.border,
                      borderRadius: 12,
                      padding: 10,
                      backgroundColor: t.colors.surface,
                    }}
                  >
                    <Text style={{ flex: 1, color: t.colors.text }}>
                      {rows.find((r) => r.business_id === w.business_id)?.business_profiles?.name ?? ''}
                      {' · '}
                      {w.desired_date}
                      {w.status === 'notified' ? ` · ${tr('wl.statusNotified')}` : ''}
                    </Text>
                    <Button
                      label={tr('wl.leave')}
                      size="sm"
                      variant="secondary"
                      onPress={() => void leaveMyWaitlist(w.id)}
                    />
                  </View>
                ))}
              </View>
            ) : null}
            <Button
              label={tr('int.title')}
              variant="secondary"
              icon="document-text-outline"
              onPress={() => router.push('/(app)/intake' as never)}
            />
            {myPackages.length > 0 ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ fontWeight: '800', color: t.colors.text }}>{tr('pkg.myTitle')}</Text>
                {myPackages.map((p) => (
                  <Text key={p.id} style={{ color: t.colors.text }}>
                    {p.business_profiles?.name ?? ''} · {p.packages?.name ?? ''} ·{' '}
                    {tr('pkg.mySessions', {
                      left: sessionsLeft(p.sessions_total, p.sessions_used),
                    })}
                  </Text>
                ))}
              </View>
            ) : null}
            {myReferralCode ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={{ fontWeight: '800', color: t.colors.text }}>{tr('ref.title')}</Text>
                <Text style={{ color: t.colors.textMuted }}>{tr('ref.desc')}</Text>
                <Text style={{ color: t.colors.text }}>
                  {tr('ref.code', { code: myReferralCode })}
                </Text>
                <Button
                  label={tr('ref.share')}
                  variant="secondary"
                  onPress={() =>
                    void Share.share({
                      message: tr('ref.shareText', {
                        code: myReferralCode ?? '',
                        url: getPublicWebOrigin(),
                      }),
                    })
                  }
                />
                {myReferrals.length > 0 ? (
                  <Text style={{ color: t.colors.text }}>
                    {tr('ref.reported', { n: myReferrals.length })} ·{' '}
                    {myReferrals
                      .map((r) =>
                        r.status === 'rewarded' ? tr('ref.rewarded') : tr('ref.pending')
                      )
                      .join(', ')}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <View style={{ gap: spacing.sm }}>
              <Field
                label={tr('pkg.checkGift')}
                value={giftCode}
                onChangeText={setGiftCode}
                placeholder={tr('pkg.checkGiftPh')}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <Button label={tr('pkg.checkBtn')} variant="secondary" onPress={() => void checkGiftCard()} />
              {giftResult ? <Text style={{ color: t.colors.text }}>{giftResult}</Text> : null}
            </View>
            {reviewingId ? (
              <View style={{ gap: spacing.md }}>
                <Callout tone="accent" title={tr('my.review')}>
                  {tr('my.pickStars')}
                </Callout>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setReviewRating(n)} hitSlop={6}>
                      <Text style={{ fontSize: 22 }}>{n <= reviewRating ? '★' : '☆'}</Text>
                    </Pressable>
                  ))}
                </View>
                <Field
                  label={tr('my.commentLabel')}
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  placeholder={tr('my.commentPlaceholder')}
                />
                <Button label={tr('my.sendReview')} onPress={() => void saveReview()} />
                <Button
                  label={tr('appt.giveUp')}
                  variant="secondary"
                  onPress={() => {
                    setReviewingId(null);
                    setReviewComment('');
                  }}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="calendar-clear-outline"
            title={
              rows.length === 0
                ? tr('my.emptyNone')
                : filter === 'upcoming'
                  ? tr('my.emptyUpcoming')
                  : tr('my.emptyPast')
            }
            description={
              rows.length === 0
                ? tr('my.emptyNoneDesc')
                : tr('my.emptyFilteredDesc')
            }
            action={
              rows.length === 0 ? (
                <View style={{ gap: spacing.sm, alignItems: 'stretch', width: '100%' }}>
                  <Button
                    label={tr('home.scanQr')}
                    icon="qr-code-outline"
                    onPress={() => router.push('/(app)/scan' as never)}
                  />
                  <Text
                    style={{
                      color: t.colors.textMuted,
                      fontSize: 13,
                      textAlign: 'center',
                      flexShrink: 1,
                    }}
                    numberOfLines={2}
                  >
                    {tr('my.openLinkHint')}
                  </Text>
                </View>
              ) : undefined
            }
          />
        }
        renderItem={({ item }) => (
          <AppointmentCard
            appointment={item}
            businessName={item.business_profiles?.name}
            localLabel={localLabel(item)}
            cancelNoticeMinutes={item.business_profiles?.cancel_notice_minutes}
            onShare={() => {
              const biz = item.business_profiles?.name ?? tr('my.salonFallback');
              const when = localLabel(item);
              void Share.share({
                message: tr('my.shareMsg', {
                  biz,
                  when,
                  service: item.service_name ? ` · ${item.service_name}` : '',
                }),
              });
            }}
            onCancel={() => cancelAppointment(item)}
            onCancelSeries={item.recurring_series_id ? () => void cancelSeries(item) : undefined}
            canCancel={canClientCancel(item, item.business_profiles)}
            canReschedule={
              canClientReschedule(item, item.business_profiles) &&
              Boolean(item.business_profiles?.public_code)
            }
            onReschedule={() => {
              const code = item.business_profiles?.public_code;
              if (!code) return;
              router.push(
                `/(app)/book/${code}?rescheduleId=${item.id}` as never
              );
            }}
            canConfirm={canConfirmAttendance(item)}
            onConfirmAttendance={() => confirmAttendance(item.id)}
            onReview={
              canReview(item)
                ? () => {
                    setReviewingId(item.id);
                    setReviewRating(reviewsByApt[item.id]?.rating ?? 5);
                    setReviewComment(reviewsByApt[item.id]?.comment ?? '');
                  }
                : undefined
            }
            reviewLabel={
              reviewsByApt[item.id] ? tr('my.yourReview', { rating: reviewsByApt[item.id].rating }) : undefined
            }
            checkedIn={Boolean(item.checked_in_at)}
            checkInLoading={checkInBusyId === item.id}
            onCheckIn={
              canCheckIn(
                { status: item.status, startAt: item.start_at, checkedInAt: item.checked_in_at ?? null },
                new Date()
              )
                ? () => void handleCheckIn(item)
                : undefined
            }
            onGoogleReview={
              item.status === 'approved' &&
              new Date(item.end_at).getTime() < Date.now() &&
              item.business_profiles?.google_review_url
                ? () => void Linking.openURL(item.business_profiles!.google_review_url!)
                : undefined
            }
            onAddToCalendar={() =>
              void addAppointmentToCalendar({
                id: item.id,
                title: tr('my.calTitle', { name: item.business_profiles?.name ?? 'business' }),
                description: item.service_name ?? undefined,
                startIso: item.start_at,
                endIso: item.end_at,
              })
            }
            onDrive={
              item.business_profiles &&
              hasLocation(locationFromBusiness(item.business_profiles as BusinessProfile))
                ? () =>
                    void openDriveChooser(
                      locationFromBusiness(item.business_profiles as BusinessProfile)
                    )
                : undefined
            }
            driveAddress={
              item.business_profiles
                ? formatAddress(
                    locationFromBusiness(item.business_profiles as BusinessProfile)
                  ) ?? undefined
                : undefined
            }
          />
        )}
      />
    </Screen>
    <ClientTabBar badges={{ appointments: pendingCount }} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  headerBlock: { gap: spacing.md, marginBottom: spacing.xs },
});
