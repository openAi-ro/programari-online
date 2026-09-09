import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { WorkingHoursForm } from '@/components/WorkingHoursForm';
import {
  Button,
  Callout,
  Field,
  LoadingScreen,
  Screen,
  Toggle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  DEFAULT_BREAK_HOURS,
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_HOURS,
} from '@/lib/defaults';
import { useBack } from '@/lib/nav';
import { generatePublicCode } from '@/lib/publicCode';
import { supabase } from '@/lib/supabase';
import type { BreakHours, BusinessProfile, WorkingHours } from '@/lib/types';

export default function BusinessSetupScreen() {
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
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
    return <LoadingScreen label="Se încarcă configurarea…" />;
  }

  return (
    <Screen
      title="Configurare business"
      subtitle={existingId ? 'Editează programul și durata' : 'Creează primul tău business'}
      onBack={back}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Callout tone="danger" title="Verifică datele">
              {error}
            </Callout>
          ) : null}
          {message ? (
            <Callout tone="success" title="Gata">
              {message}
            </Callout>
          ) : null}
          <Button
            label={saving ? 'Se salvează…' : existingId ? 'Salvează modificările' : 'Creează business'}
            icon="checkmark"
            loading={saving}
            onPress={handleSave}
          />
          {publicCode ? (
            <Button
              label="Vezi codul QR"
              variant="secondary"
              icon="qr-code-outline"
              onPress={() => router.push('/(app)/business/qr' as never)}
            />
          ) : null}
        </View>
      }
    >
      <Field
        label="Nume business"
        value={name}
        onChangeText={setName}
        placeholder="Cabinet / Salon / Barbershop"
        icon="storefront-outline"
        autoCapitalize="words"
      />
      <Field
        label="Durată ședință (minute)"
        value={duration}
        onChangeText={setDuration}
        placeholder="60"
        keyboardType="number-pad"
        icon="time-outline"
        hint="Între 5 și 480 de minute. Cât durează o programare obișnuită."
      />
      <Field
        label="Timezone (IANA)"
        value={timezone}
        onChangeText={setTimezone}
        placeholder="Europe/Bucharest"
        icon="globe-outline"
        autoCapitalize="none"
        hint="Programul de lucru se afișează clienților în fusul orar ales."
      />

      <WorkingHoursForm value={workingHours} onChange={setWorkingHours} />

      <View
        style={[
          styles.breakRow,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.breakTitles}>
          <Text style={[styles.breakTitle, { color: t.colors.text }]}>Pauză opțională</Text>
          <Text style={[styles.breakSub, { color: t.colors.textMuted }]}>
            Nu se pot programa clienți în acest interval
          </Text>
        </View>
        <Toggle
          value={breakHours.enabled}
          onValueChange={(enabled) => setBreakHours({ ...breakHours, enabled })}
          accessibilityLabel="Pauză opțională"
        />
      </View>
      {breakHours.enabled ? (
        <View style={styles.breakTimes}>
          <View style={styles.breakCol}>
            <Field
              label="Pauză de la"
              value={breakHours.start}
              onChangeText={(start) => setBreakHours({ ...breakHours, start })}
              placeholder="13:00"
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              style={styles.breakInput}
            />
          </View>
          <View style={styles.breakCol}>
            <Field
              label="Până la"
              value={breakHours.end}
              onChangeText={(end) => setBreakHours({ ...breakHours, end })}
              placeholder="14:00"
              maxLength={5}
              keyboardType="numbers-and-punctuation"
              style={styles.breakInput}
            />
          </View>
        </View>
      ) : null}

      {publicCode ? (
        <Callout tone="accent" title={`Cod public: ${publicCode}`}>
          Codul acesta intră în linkul de programare și în codul QR.
        </Callout>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  breakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  breakTitles: { flex: 1, gap: 2 },
  breakTitle: { fontSize: fontSize.md, fontWeight: '600' },
  breakSub: { fontSize: fontSize.sm, lineHeight: 18 },
  breakTimes: { flexDirection: 'row', gap: spacing.md },
  breakCol: { flex: 1 },
  breakInput: { textAlign: 'center' },
});
