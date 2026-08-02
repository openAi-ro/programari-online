import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { WorkingHoursForm } from '@/components/WorkingHoursForm';
import {
  DEFAULT_BREAK_HOURS,
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_HOURS,
} from '@/lib/defaults';
import { generatePublicCode } from '@/lib/publicCode';
import { supabase } from '@/lib/supabase';
import type { BreakHours, BusinessProfile, WorkingHours } from '@/lib/types';

export default function BusinessSetupScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [duration, setDuration] = useState('60');
  const [workingHours, setWorkingHours] = useState<WorkingHours>(DEFAULT_WORKING_HOURS);
  const [breakHours, setBreakHours] = useState<BreakHours>(DEFAULT_BREAK_HOURS);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('business_profiles')
        .select('*')
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (data) {
        const b = data as BusinessProfile;
        setExistingId(b.id);
        setPublicCode(b.public_code);
        setName(b.name);
        setTimezone(b.timezone || DEFAULT_TIMEZONE);
        setDuration(String(b.session_duration_minutes));
        setWorkingHours(b.working_hours);
        setBreakHours(b.break_hours ?? DEFAULT_BREAK_HOURS);
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    setError(null);
    setMessage(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Introdu numele business-ului.');
      return;
    }
    const minutes = parseInt(duration, 10);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
      setError('Durata trebuie să fie între 5 și 480 minute.');
      return;
    }
    if (!timezone.trim()) {
      setError('Timezone-ul este obligatoriu.');
      return;
    }

    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      setError('Nu ești autentificat.');
      return;
    }

    if (existingId) {
      const { error: err } = await supabase
        .from('business_profiles')
        .update({
          name: trimmed,
          timezone: timezone.trim(),
          session_duration_minutes: minutes,
          working_hours: workingHours,
          break_hours: breakHours,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId);
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      setMessage('Business actualizat.');
      return;
    }

    const code = generatePublicCode();
    const { data, error: err } = await supabase
      .from('business_profiles')
      .insert({
        owner_user_id: user.id,
        name: trimmed,
        public_code: code,
        timezone: timezone.trim(),
        session_duration_minutes: minutes,
        working_hours: workingHours,
        break_hours: breakHours,
      })
      .select('*')
      .single();
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    const b = data as BusinessProfile;
    setExistingId(b.id);
    setPublicCode(b.public_code);
    setMessage('Business creat. Poți genera QR din meniu.');
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Text style={styles.heading}>Configurare business</Text>

      <Text style={styles.label}>Timezone (IANA)</Text>
      <TextInput
        style={styles.input}
        value={timezone}
        onChangeText={setTimezone}
        autoCapitalize="none"
        placeholder="Europe/Bucharest"
      />

      <Text style={styles.label}>Nume business</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Cabinet / Salon / etc."
      />

      <Text style={styles.label}>Durată ședință (minute)</Text>
      <TextInput
        style={styles.input}
        value={duration}
        onChangeText={setDuration}
        keyboardType="number-pad"
        placeholder="60"
      />

      <WorkingHoursForm value={workingHours} onChange={setWorkingHours} />

      <View style={styles.breakRow}>
        <Text style={styles.label}>Pauză opțională</Text>
        <Switch
          value={breakHours.enabled}
          onValueChange={(enabled) => setBreakHours({ ...breakHours, enabled })}
        />
      </View>
      {breakHours.enabled ? (
        <View style={styles.breakTimes}>
          <TextInput
            style={[styles.input, styles.time]}
            value={breakHours.start}
            onChangeText={(start) => setBreakHours({ ...breakHours, start })}
            placeholder="13:00"
            maxLength={5}
          />
          <Text>–</Text>
          <TextInput
            style={[styles.input, styles.time]}
            value={breakHours.end}
            onChangeText={(end) => setBreakHours({ ...breakHours, end })}
            placeholder="14:00"
            maxLength={5}
          />
        </View>
      ) : null}

      {publicCode ? (
        <Text style={styles.code}>Cod public: {publicCode}</Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
        <Text style={styles.buttonText}>{saving ? 'Se salvează…' : 'Salvează'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  label: { fontSize: 13, color: '#475569', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fafafa',
  },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  breakTimes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  time: { width: 90, textAlign: 'center' },
  code: { marginTop: 12, color: '#334155', fontWeight: '500' },
  button: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  error: { color: '#b91c1c', marginTop: 10 },
  message: { color: '#166534', marginTop: 10 },
});
