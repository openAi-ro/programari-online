import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Session } from '@supabase/supabase-js';

import { DatePickerField } from '@/components/DatePickerField';
import type { DateInputIssue } from '@/lib/dateInput';
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
  maxBookingDate,
  notBeforeUtc,
  staffSchedule,
  toYmd,
} from '@/lib/bookingRules';
import { createAppointmentIfFree, createGuestAppointment, listBusyRanges, notifyAfterBooking } from '@/lib/bookingRpc';
import { formatDuration, formatLei, formatRon } from '@/lib/format';
import { formatAddress, locationFromBusiness } from '@/lib/location';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { markWaitlistBooked } from '@/lib/notify-client';
import { normalizeWalkinContact } from '@/lib/walkinRules';
import { mapPayError, startDepositCheckout } from '@/lib/payments';
import { parseTipInput, tipOptions } from '@/lib/tip';
import { generateFreeSlots } from '@/lib/slots';
import { createRequestTracker } from '@/lib/latestRequest';
import { localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, FreeSlot, Service, Staff } from '@/lib/types';

/** Public HTTPS booking page: /b/{publicCode} — works in browser without installing the app. */
export default function PublicBookScreen() {
  const t = useTheme();
  const goBack = useBack();
  const tr = useT();
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
  const [reviewSnippets, setReviewSnippets] = useState<
    { rating: number; comment: string }[]
  >([]);
  const [logoFailed, setLogoFailed] = useState(false);
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  // Data tastată nu e (încă) utilizabilă: nu arătăm sloturile datei anterioare.
  const [dateIssue, setDateIssue] = useState<DateInputIssue | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
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
      const { data: revRows } = await supabase.rpc('list_public_reviews', {
        p_business_id: biz.id,
        p_limit: 2,
      });
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

  const loadSlots = useCallback(async () => {
    if (!business) return;
    const req = slotsRequests.start();
    setSlotsLoading(true);
    setSelected(null);
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
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
  }, [business, dateLocal, durationMinutes, staffId, selectedStaff, slotsRequests]);

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
      setError(trKey('book.pickSlot'));
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
    let payError: string | null = null;
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
    const { appointment: created, error: err } = await createGuestAppointment({
      businessId: business.id,
      startAt: selected.startUtc,
      endAt: selected.endUtc,
      serviceId,
      staffId,
      name,
      phone: contact.phone,
      email: contact.email,
    });
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
  const shownSlots = dateIssue ? [] : slots;
  const noSlots = !dateIssue && !slotsLoading && slots.length === 0;

  return (
    <Screen
      title={business.name}
      subtitle={tr('pub.online')}
      onBack={goBack}
      footer={
        <>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {message ? <Callout tone="success">{message}</Callout> : null}
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
          {formatAddress(locationFromBusiness(business)) ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]} numberOfLines={2}>
              {formatAddress(locationFromBusiness(business))}
            </Text>
          ) : null}
          {rating && rating.review_count > 0 ? (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
              ★ {Number(rating.avg_rating).toFixed(1)} · {rating.review_count} {tr('book.reviewMany')}
            </Text>
          ) : (
            <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
              {tr('book.noReviews')}
            </Text>
          )}
          <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
            {selectedService
              ? `${selectedService.name} · ${formatDuration(selectedService.duration_minutes)} · ${formatRon(selectedService.price)}`
              : `${durationMinutes} min · ${business.timezone}`}
          </Text>
          {reviewSnippets.length > 0
            ? reviewSnippets.slice(0, 2).map((r, i) => (
                <Text
                  key={i}
                  style={[styles.summaryMeta, { color: t.colors.accentSoftText, opacity: 0.9 }]}
                  numberOfLines={2}
                >
                  {'★'.repeat(Math.min(5, Math.max(1, r.rating)))}
                  {r.comment?.trim() ? ` — ${r.comment.trim()}` : ''}
                </Text>
              ))
            : null}
        </View>
        <Badge tone="accent">{tr('book.freeCount', { n: shownSlots.length })}</Badge>
      </View>

      <LocationCard location={locationFromBusiness(business)} />

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

      {staffList.length > 1 ? (
        <>
          <SectionTitle>{tr('pub.stepStaff')}</SectionTitle>
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
      <DatePickerField
        label={tr('book.dateLabel')}
        value={dateLocal}
        onChange={setDateLocal}
        onIssueChange={(issue) => {
          setDateIssue(issue);
          if (issue) setSelected(null);
        }}
        minimumDate={minDate}
        maximumDate={maxDate}
      />

      <SectionTitle>{tr('pub.stepTime')}</SectionTitle>
      {dateIssue ? (
        <Callout tone="warning">
          {tr(dateIssue === 'incomplete' ? 'book.dateInvalid' : 'book.dateOutOfRange')}
        </Callout>
      ) : slotsLoading ? (
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
});
