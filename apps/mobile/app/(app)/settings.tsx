import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  Field,
  LoadingScreen,
  Screen,
  SectionTitle,
  SettingRow,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { signOut } from '@/lib/auth';
import { useBack } from '@/lib/nav';
import { registerForPushAsync } from '@/lib/notifications';
import { invokeTestWhatsApp } from '@/lib/notify-client';
import {
  formatPhoneDisplay,
  isValidRoMobile,
  normalizePhoneE164,
} from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export default function SettingsScreen() {
  const t = useTheme();
  const back = useBack();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        .from('profiles')
        .select('id, email, phone, display_name')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setProfile(data as Profile);
        setDisplayName(data.display_name ?? '');
        setPhoneInput(data.phone ? formatPhoneDisplay(data.phone) : '');
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!profile) return;

    const normalized = phoneInput.trim()
      ? normalizePhoneE164(phoneInput.trim())
      : profile.phone;

    if (phoneInput.trim() && !normalized) {
      setError('Număr invalid. Folosește format 07xxxxxxxx sau +407xxxxxxxx.');
      return;
    }

    if (phoneInput.trim() && normalized && !isValidRoMobile(normalized)) {
      setError('Număr mobil invalid pentru România.');
      return;
    }

    if (!profile.email && !normalized) {
      setError('Trebuie email sau telefon pe cont.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const { error: err } = await supabase
      .from('profiles')
      .update({
        display_name: displayName.trim() || null,
        phone: normalized,
      })
      .eq('id', profile.id);

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }

    setProfile({ ...profile, phone: normalized, display_name: displayName.trim() || null });
    if (normalized) setPhoneInput(formatPhoneDisplay(normalized));
    setMessage('Profil actualizat.');
  }

  async function handleTestWhatsApp() {
    if (!profile) return;
    setWaBusy(true);
    setError(null);
    setMessage(null);

    const normalized = phoneInput.trim()
      ? normalizePhoneE164(phoneInput.trim())
      : profile.phone;

    if (phoneInput.trim() && normalized && normalized !== profile.phone) {
      const { error: saveErr } = await supabase
        .from('profiles')
        .update({ phone: normalized })
        .eq('id', profile.id);
      if (saveErr) {
        setWaBusy(false);
        setError(saveErr.message);
        return;
      }
      setProfile({ ...profile, phone: normalized });
    }

    if (!normalized) {
      setWaBusy(false);
      setError('Adaugă numărul de telefon mai întâi (07xx...).');
      return;
    }

    try {
      const result = await invokeTestWhatsApp();
      if (!result.ok) {
        setError(result.error ?? 'Nu s-a putut trimite mesajul test.');
        return;
      }
      if (result.data?.result?.stub) {
        setMessage(
          result.data.hint ??
            'Serverul nu are WhatsApp configurat — mesajul a fost simulat (vezi logs Supabase).'
        );
      } else {
        setMessage(
          `Mesaj test trimis pe WhatsApp la ${formatPhoneDisplay(result.data?.phone ?? normalized)}.`
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la test WhatsApp.');
    } finally {
      setWaBusy(false);
    }
  }

  async function handleReregisterPush() {
    if (!profile) return;
    setPushBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await registerForPushAsync(profile.id);
      if (result.token) {
        setMessage('Notificările push au fost reînregistrate pe acest dispozitiv.');
      } else if (result.reason === 'simulator') {
        setError('Push funcționează doar pe dispozitiv fizic, nu pe simulator.');
      } else if (result.reason === 'permission_denied') {
        setError('Permisiunea pentru notificări a fost refuzată. Activeaz-o din setările telefonului.');
      } else {
        setError(result.reason ?? 'Nu s-a putut înregistra token-ul push.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la înregistrarea push.');
    } finally {
      setPushBusy(false);
    }
  }

  async function handleLogout() {
    setError(null);
    const { error: err } = await signOut();
    if (err) setError(err.message);
  }

  if (loading) {
    return <LoadingScreen label="Se încarcă profilul…" />;
  }

  return (
    <Screen
      title="Setări"
      subtitle="Profil, notificări și conectare"
      onBack={back}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Callout tone="danger" title="A apărut o eroare">
              {error}
            </Callout>
          ) : null}
          {message ? (
            <Callout tone="success" title="Gata">
              {message}
            </Callout>
          ) : null}
          <Button
            label={saving ? 'Se salvează…' : 'Salvează profilul'}
            icon="checkmark"
            loading={saving}
            onPress={handleSave}
          />
        </View>
      }
    >
      <Card
        icon="person-circle-outline"
        iconTone="neutral"
        title={profile?.display_name || profile?.email || 'Cont'}
        hint={
          profile?.phone
            ? formatPhoneDisplay(profile.phone)
            : 'Fără telefon adăugat — notificările WhatsApp nu pot fi trimise.'
        }
      />

      <SectionTitle>Date de contact</SectionTitle>
      <Field
        label="Telefon (WhatsApp)"
        value={phoneInput}
        onChangeText={setPhoneInput}
        placeholder="07xxxxxxxx"
        keyboardType="phone-pad"
        autoComplete="tel"
        icon="logo-whatsapp"
        hint="Necesar pentru confirmări și reminder-uri WhatsApp. Format 07xx sau +407xx."
      />
      <Field
        label="Nume afișat"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Numele tău"
        icon="person-outline"
        autoCapitalize="words"
      />

      <SectionTitle>WhatsApp</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          Trimite un mesaj test pe numărul de mai sus. Necesită configurare Meta sau
          Twilio pe Supabase (vezi README).
        </Text>
        <Button
          label={waBusy ? 'Se trimite…' : 'Trimite mesaj test'}
          variant="success"
          size="md"
          icon="logo-whatsapp"
          loading={waBusy}
          disabled={waBusy || !profile}
          onPress={handleTestWhatsApp}
        />
      </View>

      <SectionTitle>Notificări push</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          Necesare dacă ești business: primești alertă când apare o cerere în așteptare.
        </Text>
        <Button
          label={pushBusy ? 'Se înregistrează…' : 'Reînregistrează notificările'}
          variant="secondary"
          size="md"
          icon="notifications-outline"
          loading={pushBusy}
          disabled={pushBusy || !profile}
          onPress={handleReregisterPush}
        />
      </View>

      <SectionTitle>Cont</SectionTitle>
      <SettingRow
        icon="log-out-outline"
        title="Deconectare"
        description="Te poți întoarce oricând cu aceleași date de autentificare."
        onPress={handleLogout}
        danger
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  panelText: { fontSize: fontSize.sm, lineHeight: 19 },
});
