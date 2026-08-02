import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { SlotPicker } from '@/components/SlotPicker';
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
  const { publicCode } = useLocalSearchParams<{ publicCode: string }>();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [dateLocal, setDateLocal] = useState(defaultBookingDateYmd());
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selected, setSelected] = useState<FreeSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const durationLabel = useMemo(
    () => (business ? `${business.session_duration_minutes} min` : ''),
    [business]
  );

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
    setMessage('Cererea a fost trimisă. Așteaptă confirmarea.');
    setSelected(null);
    await loadSlots();
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!business) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Eroare'}</Text>
        <Pressable onPress={() => router.back()} style={styles.button}>
          <Text style={styles.buttonText}>Înapoi</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{business.name}</Text>
      <Text style={styles.meta}>
        Durată: {durationLabel} · {business.timezone}
      </Text>

      <Text style={styles.label}>Data (YYYY-MM-DD)</Text>
      <TextInput
        style={styles.input}
        value={dateLocal}
        onChangeText={setDateLocal}
        autoCapitalize="none"
        placeholder="2026-08-03"
      />

      <Text style={styles.label}>Sloturi libere</Text>
      {slotsLoading ? (
        <ActivityIndicator style={{ marginVertical: 12 }} />
      ) : (
        <SlotPicker
          slots={slots}
          selectedStartUtc={selected?.startUtc}
          onSelect={setSelected}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable
        style={[styles.button, (!selected || booking) && styles.buttonDisabled]}
        onPress={handleBook}
        disabled={!selected || booking}
      >
        <Text style={styles.buttonText}>
          {booking ? 'Se trimite…' : 'Trimite cererea'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 22, fontWeight: '700' },
  meta: { color: '#64748b', marginTop: 4, marginBottom: 16 },
  label: { fontSize: 13, color: '#475569', marginTop: 12, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fafafa',
  },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#b91c1c', marginTop: 12 },
  message: { color: '#166534', marginTop: 12 },
});
