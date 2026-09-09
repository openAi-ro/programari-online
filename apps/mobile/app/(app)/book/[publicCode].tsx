import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import { SlotPicker } from '@/components/SlotPicker';
import {
  Badge,
  Button,
  Callout,
  ErrorState,
  LoadingScreen,
  Screen,
  SectionTitle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { useBack } from '@/lib/nav';
import { generateFreeSlots } from '@/lib/slots';
import { localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile, FreeSlot } from '@/lib/types';

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Default to next Mon–Fri (agenda e închisă sâmbătă/duminică în config). */
function defaultBookingDateYmd(): string {
  const d = new Date();
  for (let i = 0; i < 7; i++) {
    const day = d.getDay(); // 0=Sun … 6=Sat
    if (day !== 0 && day !== 6) return toYmd(d);
    d.setDate(d.getDate() + 1);
  }
  return toYmd(new Date());
}

function mapRpcError(message: string): string {
  if (message.includes('contact_required')) {
    return 'Contul trebuie să aibă email sau telefon.';
  }
  if (message.includes('slot_taken')) {
    return 'Slotul tocmai a fost rezervat. Alege altul.';
  }
  if (message.includes('not_authenticated')) {
    return 'Trebuie să fii autentificat.';
  }
  return message;
}

export default function BookScreen() {
  const t = useTheme();
  const { publicCode } = useLocalSearchParams<{ publicCode: string }>();
  const goBack = useBack();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [dateLocal, setDateLocal] = useState(defaultBookingDateYmd());
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return d;
  }, []);

  useEffect(() => {
    (async () => {
      setError(null);
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
      } else if (!data) {
        setError('Business-ul nu a fost găsit.');
      } else {
        setBusiness(data as BusinessProfile);
      }
      setLoading(false);
    })();
  }, [publicCode]);

  const loadSlots = useCallback(async () => {
    if (!business) return;
    setSlotsLoading(true);
    setSelected(null);
    setError(null);
    setMessage(null);

    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);

    const { data: appointments, error: err } = await supabase
      .from('appointments')
      .select('start_at, end_at, status')
      .eq('business_id', business.id)
      .in('status', ['pending', 'approved'])
      .lt('start_at', endUtc.toISOString())
      .gt('end_at', startUtc.toISOString());

    if (err) {
      setError(err.message);
      setSlots([]);
      setSlotsLoading(false);
      return;
    }

    const busy = (appointments ?? []).map((a) => ({
      startUtc: a.start_at as string,
      endUtc: a.end_at as string,
    }));

    const free = generateFreeSlots({
      dateLocal,
      timezone: business.timezone,
      sessionDurationMinutes: business.session_duration_minutes,
      workingHours: business.working_hours,
      breakHours: business.break_hours,
      busy,
    });
    setSlots(free);
    setSlotsLoading(false);
  }, [business, dateLocal]);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  async function handleBook() {
    if (!business || !selected) {
      setError('Alege un slot.');
      return;
    }
    setBooking(true);
    setError(null);
    setMessage(null);

    const { error: err } = await supabase.rpc('create_appointment_if_free', {
      p_business_id: business.id,
      p_start_at: selected.startUtc,
      p_end_at: selected.endUtc,
    });

    setBooking(false);
    if (err) {
      setError(mapRpcError(err.message));
      await loadSlots();
      return;
    }
    // Mesajul se setează după reîncărcare: `loadSlots` golește starea de mesaj.
    setSelected(null);
    await loadSlots();
    setMessage('Cererea a fost trimisă. Așteaptă confirmarea.');
  }

  if (loading) {
    return <LoadingScreen label="Căutăm agenda…" />;
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

  return (
    <Screen
      title={business.name}
      subtitle={`${business.session_duration_minutes} min · ${business.timezone}`}
      onBack={goBack}
      footer={
        <>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          {message ? <Callout tone="success">{message}</Callout> : null}
          <Button
            label={booking ? 'Se trimite…' : 'Trimite cererea'}
            icon="paper-plane-outline"
            onPress={handleBook}
            loading={booking}
            disabled={!selected}
          />
        </>
      }
    >
      <View style={[styles.summary, { backgroundColor: t.colors.accentSoft }]}>
        <View style={[styles.summaryIcon, { backgroundColor: t.colors.accent }]}>
          <Ionicons name="storefront" size={20} color={t.colors.onAccent} />
        </View>
        <View style={styles.flex}>
          <Text style={[styles.summaryName, { color: t.colors.accentSoftText }]}>
            {business.name}
          </Text>
          <Text style={[styles.summaryMeta, { color: t.colors.accentSoftText }]}>
            Ședință de {business.session_duration_minutes} min · {business.timezone}
          </Text>
        </View>
        <Badge tone="accent">{slots.length} libere</Badge>
      </View>

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

      <SectionTitle>
        Ora — doar din sloturile libere
      </SectionTitle>

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
        />
      )}

      <Text style={[styles.note, { color: t.colors.textFaint }]}>
        Ora nu se poate modifica manual — alege un slot liber de mai sus. După trimitere,
        cererea apare ca „în așteptare” până la confirmare.
      </Text>
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
  timeLockedLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeLockedLabel: { fontSize: fontSize.sm, fontWeight: '600' },
  timeLockedValue: { fontSize: fontSize.xl, fontWeight: '800' },
  slotsLoading: { paddingVertical: spacing['2xl'], alignItems: 'center' },
  note: { fontSize: fontSize.xs, lineHeight: 17 },
});
