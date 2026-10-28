import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Linking, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
import { ClientTabBar } from '@/components/ClientTabBar';
import {
  activeUpcomingAppointments,
  hasEnded,
  pastAppointments,
} from '@/lib/appointmentTime';
import {
  Button,
  ButtonRow,
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
  toYmd,
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
import { shareText } from '@/lib/shareBusiness';
import { makeReferralCode } from '@/lib/referral';
import { getPublicWebOrigin } from '@/lib/webBase';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { Appointment, BusinessProfile, Review } from '@/lib/types';
import { localeTag, trKey, useT } from '@/lib/i18n';
import { useTransientMessage } from '@/lib/useTransientMessage';

type WaitlistItem = {
  id: string;
  desired_date: string;
  status: string;
  business_id: string;
  business_profiles: { name: string } | null;
};

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

type BizRow = NonNullable<Row['business_profiles']> & { id: string };

type Filter = 'all' | 'upcoming' | 'past';

export default function MyAppointmentsScreen() {
  const tr = useT();
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useTransientMessage();
  const [success, setSuccess] = useTransientMessage();
  const [filter, setFilter] = useState<Filter>('all');
  const [reviewsByApt, setReviewsByApt] = useState<Record<string, Review>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [myWaitlist, setMyWaitlist] = useState<WaitlistItem[]>([]);
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
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      setError(trKey('auth.notSignedIn'), { sticky: true });
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
      setError(err.message, { sticky: true });
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
    const bizById: Record<string, Row['business_profiles']> = {};
    if (bizIds.length) {
      // RPC-ul întoarce și business-urile private la care clientul are programări (RLS le-ar ascunde).
      const { data: own } = await supabase.rpc('my_appointment_businesses');
      const found = (own ?? []) as BizRow[];
      const missing = bizIds.filter((id) => !found.some((b) => b.id === id));
      if (missing.length) {
        // Programări legate doar prin email/telefon: business-urile publice, citite direct.
        const { data: more } = await supabase
          .from('business_profiles')
          .select(
            'id, name, timezone, public_code, cancel_notice_minutes, county, city, address, maps_url, google_review_url, latitude, longitude'
          )
          .in('id', missing);
        found.push(...((more ?? []) as BizRow[]));
      }
      for (const b of found) {
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
    let partialFail = false;
    if (aptIds.length) {
      const { data: revs, error: revErr } = await supabase
        .from('reviews')
        .select(
          'id, business_id, appointment_id, client_user_id, staff_id, rating, comment, created_at'
        )
        .in('appointment_id', aptIds);
      if (revErr) partialFail = true;
      for (const r of (revs ?? []) as Review[]) map[r.appointment_id] = r;
    }
    const { data: wl, error: wlErr } = await supabase
      .from('waitlist')
      .select('id, desired_date, status, business_id, business_profiles(name)')
      .eq('client_user_id', user.id)
      .in('status', ['active', 'notified'])
      .gte('desired_date', toYmd(new Date()))
      .order('desired_date', { ascending: true });
    if (wlErr) partialFail = true;
    setMyWaitlist((wl ?? []) as unknown as WaitlistItem[]);
    const { data: pkgs, error: pkgErr } = await supabase
      .from('client_packages')
      .select('id, sessions_total, sessions_used, packages(name), business_profiles(name)')
      .eq('client_user_id', user.id)
      .order('created_at', { ascending: false });
    if (pkgErr) partialFail = true;
    setMyPackages((pkgs ?? []) as unknown as typeof myPackages);
    const { data: me } = await supabase
      .from('profiles')
      .select('referral_code')
      .eq('id', user.id)
      .maybeSingle();
    let code = (me?.referral_code as string | null) ?? null;
    if (!code) {
      const generated = makeReferralCode();
      const { error: saveErr } = await supabase
        .from('profiles')
        .update({ referral_code: generated })
        .eq('id', user.id);
      // Codul se afiseaza doar daca a fost salvat; altfel prietenul nu l-ar putea folosi.
      if (!saveErr) code = generated;
    }
    setMyReferralCode(code);
    const { data: refs, error: refsErr } = await supabase
      .from('referrals')
      .select('id, status, created_at')
      .eq('referrer_user_id', user.id)
      .order('created_at', { ascending: false });
    if (refsErr) partialFail = true;
    setMyReferrals((refs ?? []) as typeof myReferrals);
    setReviewsByApt(map);
    if (partialFail) setError(trKey('my.partialLoadFail'), { sticky: true });
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
  const [seriesTarget, setSeriesTarget] = useState<Row | null>(null);
  const [tickNow, setTickNow] = useState(() => new Date());

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
    let refundFailed = false;
    if (item.payment_status === 'paid') {
      const refund = await invokeRefundDeposit(item.id);
      refundFailed = !refund.ok;
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
    if (refundFailed) {
      setError(trKey('my.refundFailed'));
    }
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


  /** Partajare cu fallback pe web: textul e copiat și clientul vede confirmarea (F-14). */
  async function shareWithFeedback(message: string) {
    try {
      if ((await shareText(message)) === 'copied') setSuccess(trKey('my.shareCopied'));
    } catch {
      setError(trKey('my.shareFailed'));
    }
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
    setSuccess(trKey('my.reviewSaved'));
    await load();
  }

  // Butoanele sensibile la timp se re-evalueaza periodic cat ecranul e deschis.
  useEffect(() => {
    const timer = setInterval(() => setTickNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const shown = useMemo(() => {
    if (filter === 'upcoming') return activeUpcomingAppointments(rows, tickNow);
    if (filter === 'past') return pastAppointments(rows, tickNow);
    return rows;
  }, [rows, filter, tickNow]);

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
              <Callout onClose={() => setError(null)} tone="danger" title={tr('chat.errorTitle')}>
                {error}
              </Callout>
            ) : null}
            {success ? (
              <Callout onClose={() => setSuccess(null)} tone="success">
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
                    <Text style={{ flex: 1, minWidth: 0, color: t.colors.text }}>
                      {w.business_profiles?.name ?? ''}
                      {' · '}
                      {new Date(`${w.desired_date}T12:00:00`).toLocaleDateString(localeTag(), {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {w.status === 'notified' ? ` · ${tr('wl.statusNotified')}` : ''}
                    </Text>
                    <View style={{ flexShrink: 0 }}>
                      <Button
                        label={tr('wl.leave')}
                        size="sm"
                        variant="secondary"
                        onPress={() => void leaveMyWaitlist(w.id)}
                      />
                    </View>
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
                    void shareWithFeedback(
                      tr('ref.shareText', {
                        code: myReferralCode ?? '',
                        url: getPublicWebOrigin(),
                      })
                    )
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
              void shareWithFeedback(
                tr('my.shareMsg', {
                  biz,
                  when,
                  service: item.service_name ? ` · ${item.service_name}` : '',
                })
              );
            }}
            onCancel={() => cancelAppointment(item)}
            onCancelSeries={item.recurring_series_id ? () => { setError(null); setSuccess(null); setSeriesTarget(item); } : undefined}
            canCancel={canClientCancel(item, item.business_profiles, tickNow)}
            canReschedule={
              canClientReschedule(item, item.business_profiles, tickNow) &&
              Boolean(item.business_profiles?.public_code)
            }
            onReschedule={() => {
              const code = item.business_profiles?.public_code;
              if (!code) return;
              router.push(
                `/(app)/book/${code}?rescheduleId=${item.id}` as never
              );
            }}
            canConfirm={canConfirmAttendance(item, tickNow)}
            onConfirmAttendance={() => confirmAttendance(item.id)}
            onReview={
              canReview(item, tickNow)
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
                {
                  status: item.status,
                  startAt: item.start_at,
                  endAt: item.end_at,
                  checkedInAt: item.checked_in_at ?? null,
                },
                tickNow
              )
                ? () => void handleCheckIn(item)
                : undefined
            }
            onGoogleReview={
              item.status === 'approved' &&
              hasEnded(item, tickNow) &&
              item.business_profiles?.google_review_url
                ? () => void Linking.openURL(item.business_profiles!.google_review_url!)
                : undefined
            }
            onAddToCalendar={() => {
              void (async () => {
                const result = await addAppointmentToCalendar({
                id: item.id,
                title: tr('my.calTitle', { name: item.business_profiles?.name ?? 'business' }),
                description: [item.service_name, item.staff_name, item.business_profiles?.name]
                  .filter(Boolean)
                  .join('\n') || undefined,
                location: item.business_profiles
                  ? formatAddress(
                      locationFromBusiness(item.business_profiles as BusinessProfile),
                    ) ?? undefined
                  : undefined,
                startIso: item.start_at,
                endIso: item.end_at,
                });
                if (result === 'failed') {
                  setSuccess(null);
                  setError(tr('cal.addFailed'));
                } else {
                  setError(null);
                  setSuccess(
                    tr(
                      result === 'added'
                        ? 'cal.added'
                        : result === 'file'
                          ? 'cal.fileShared'
                          : result === 'download'
                            ? 'cal.downloaded'
                            : 'cal.googleOpened',
                    ),
                  );
                }
              })();
            }}
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
    <Modal
      visible={seriesTarget != null}
      animationType="fade"
      transparent
      onRequestClose={() => setSeriesTarget(null)}
      statusBarTranslucent
    >
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg, backgroundColor: t.colors.overlay }}>
        <View style={{ backgroundColor: t.colors.bgElevated, borderColor: t.colors.border, borderWidth: 1, borderRadius: 16, padding: spacing.lg, gap: spacing.md }}>
          <Text style={{ color: t.colors.text, fontWeight: '800', fontSize: 16 }}>{tr('my.cancelSeriesTitle')}</Text>
          <Text style={{ color: t.colors.textMuted }}>{tr('my.cancelSeriesBody')}</Text>
          <ButtonRow>
            <View style={{ flex: 1 }}>
              <Button label={tr('appt.giveUp')} variant="secondary" size="sm" onPress={() => setSeriesTarget(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={tr('appt.cancelSeries')}
                icon="repeat-outline"
                variant="danger"
                size="sm"
                onPress={() => {
                  const target = seriesTarget;
                  setSeriesTarget(null);
                  if (target) void cancelSeries(target);
                }}
              />
            </View>
          </ButtonRow>
        </View>
      </View>
    </Modal>
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
