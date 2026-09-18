import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { AppointmentCard } from '@/components/AppointmentCard';
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
  hasCoordinates,
  locationFromBusiness,
  openDrive,
} from '@/lib/location';
import { useBack } from '@/lib/nav';
import { invokeWaitlistNotify } from '@/lib/notify-client';
import { invokeRefundDeposit, mapPayError, startDepositCheckout } from '@/lib/payments';
import { formatInTimeZone } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile, Review } from '@/lib/types';

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
    | 'latitude'
    | 'longitude'
  > | null;
};

type Filter = 'all' | 'upcoming' | 'past';

export default function MyAppointmentsScreen() {
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [payBusyId, setPayBusyId] = useState<string | null>(null);
  const [reviewsByApt, setReviewsByApt] = useState<Record<string, Review>>({});
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError('Nu ești autentificat.');
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
      const { data: businesses } = await supabase
        .from('business_profiles')
        .select(
          'id, name, timezone, public_code, cancel_notice_minutes, county, city, address, maps_url, latitude, longitude'
        )
        .in('id', bizIds);
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
          latitude: b.latitude,
          longitude: b.longitude,
        };
      }
    }

    setRows(
      list.map((a) => ({
        ...a,
        business_profiles: bizById[a.business_id] ?? null,
      }))
    );
    const { data: revs } = await supabase.from('reviews').select('*');
    const map: Record<string, Review> = {};
    for (const r of (revs ?? []) as Review[]) map[r.appointment_id] = r;
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

  async function cancelAppointment(item: Row) {
    setError(null);
    const { error: err } = await supabase.rpc('cancel_appointment', {
      p_appointment_id: item.id,
    });
    if (err) {
      setError(mapBookingRpcError(err.message));
      return;
    }
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

  async function payDeposit(id: string) {
    setError(null);
    setPayBusyId(id);
    const result = await startDepositCheckout(id);
    setPayBusyId(null);
    if (!result.ok) {
      setError(mapPayError(result.error ?? 'checkout_failed'));
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
        title="Programările mele"
        subtitle="Ce ai rezervat și ce urmează"
        onBack={back}
        label="Se încarcă programările…"
      />
    );
  }

  return (
    <Screen title="Programările mele" subtitle="Ce ai rezervat și ce urmează" onBack={back} scroll={false}>
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
                { value: 'all', label: 'Toate' },
                { value: 'upcoming', label: 'Viitoare' },
                { value: 'past', label: 'Trecute' },
              ]}
            />
            {error ? (
              <Callout tone="danger" title="A apărut o eroare">
                {error}
              </Callout>
            ) : null}
            {reviewingId ? (
              <View style={{ gap: spacing.md }}>
                <Callout tone="accent" title="Recenzie">
                  Alege stelele, apoi salvează.
                </Callout>
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable key={n} onPress={() => setReviewRating(n)} hitSlop={6}>
                      <Text style={{ fontSize: 22 }}>{n <= reviewRating ? '★' : '☆'}</Text>
                    </Pressable>
                  ))}
                </View>
                <Field
                  label="Comentariu (opțional)"
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  placeholder="Cum a fost vizita?"
                />
                <Button label="Trimite recenzia" onPress={() => void saveReview()} />
                <Button
                  label="Renunță"
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
            title={
              rows.length === 0
                ? 'Nu ai programări încă'
                : filter === 'upcoming'
                  ? 'Nicio programare viitoare'
                  : 'Nicio programare trecută'
            }
            description={
              rows.length === 0
                ? 'Scanează codul QR al unui business sau deschide un link de programare.'
                : 'Schimbă filtrul ca să vezi celelalte programări.'
            }
          />
        }
        renderItem={({ item }) => (
          <AppointmentCard
            appointment={item}
            businessName={item.business_profiles?.name}
            localLabel={localLabel(item)}
            onCancel={() => cancelAppointment(item)}
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
            onPayDeposit={() => void payDeposit(item.id)}
            payBusy={payBusyId === item.id}
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
              reviewsByApt[item.id] ? `Recenzia ta: ${reviewsByApt[item.id].rating} ★` : undefined
            }
            onAddToCalendar={() =>
              void addAppointmentToCalendar({
                id: item.id,
                title: `Programare la ${item.business_profiles?.name ?? 'business'}`,
                description: item.service_name ?? undefined,
                startIso: item.start_at,
                endIso: item.end_at,
              })
            }
            onDrive={
              item.business_profiles &&
              hasCoordinates(locationFromBusiness(item.business_profiles as BusinessProfile))
                ? () =>
                    void openDrive(
                      locationFromBusiness(item.business_profiles as BusinessProfile)
                    )
                : undefined
            }
          />
        )}
      />
    </Screen>
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
