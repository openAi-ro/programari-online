import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';

import {
  Button,
  Callout,
  Card,
  Field,
  Screen,
  SectionTitle,
  SettingRow,
  SkeletonScreen,
  Toggle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { signOut } from '@/lib/auth';
import { parseAccountKind } from '@/lib/accountKind';
import { getAppMode, type AppMode } from '@/lib/appMode';
import { useBack } from '@/lib/nav';
import {
  registerForPushAsync,
  presentStatusBarTestNotification,
  openBookingChannelSettings,
  getPushDiagnostics,
  type PushDiagnostics,
} from '@/lib/notifications';
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
  const [appMode, setAppModeState] = useState<AppMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diag, setDiag] = useState<PushDiagnostics | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [notifyReminders, setNotifyReminders] = useState(true);
  const [notifyDecision, setNotifyDecision] = useState(true);
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
        .select('id, email, phone, display_name, account_kind, notify_reminders, notify_decision')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setProfile(data as Profile);
        setDisplayName(data.display_name ?? '');
        setPhoneInput(data.phone ? formatPhoneDisplay(data.phone) : '');
        setNotifyReminders(data.notify_reminders !== false);
        setNotifyDecision(data.notify_decision !== false);
        setAppModeState(parseAccountKind(data.account_kind));
      } else {
        const stored = await getAppMode();
        setAppModeState(stored);
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
        notify_reminders: notifyReminders,
        notify_decision: notifyDecision,
      })
      .eq('id', profile.id);

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }

    setProfile({
      ...profile,
      phone: normalized,
      display_name: displayName.trim() || null,
      notify_reminders: notifyReminders,
      notify_decision: notifyDecision,
    });
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
        setError(
          result.data.hint ??
            'WhatsApp nu e configurat pe server — mesajul a fost doar logat. Setează secrets Meta sau Twilio.'
        );
        return;
      }
      setMessage(
        `Mesaj test trimis pe WhatsApp la ${formatPhoneDisplay(result.data?.phone ?? normalized)}.`
      );
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
        const local = await presentStatusBarTestNotification();
        if (local.ok) {
          setMessage(
            `Push reînregistrat. Minimalizează app-ul acum — în ${local.delaySec ?? 5}s vine testul Pop on screen. Dacă nu apare popup pe ecran, apasă „Deschide setări Pop on screen”.`
          );
        } else if (local.reason === 'channel_importance_low') {
          setMessage('Push reînregistrat, dar canalul Android e pe importance mică.');
          await openBookingChannelSettings();
          setError(
            'În setările Android: canal „Cereri programări (popup)” → activează „Pop on screen” / „Pe ecran” / importance Urgent.'
          );
        } else {
          setMessage(
            'Push reînregistrat. Testul local în bară a eșuat: ' + (local.reason ?? 'necunoscut')
          );
        }
      } else if (result.reason === 'simulator') {
        setError('Push funcționează doar pe dispozitiv fizic, nu pe simulator.');
      } else if (result.reason === 'permission_denied') {
        setError('Permisiunea pentru notificări a fost refuzată. Activeaz-o din setările telefonului.');
      } else if (result.reason === 'web_unsupported') {
        setError('Push nu e disponibil în browser. Folosește aplicația instalată pe telefon.');
      } else if (result.reason === 'push_unavailable') {
        setError(
          'Push nu e disponibil în Expo Go. Instalează build-ul APK (EAS preview) ca să primești notificări.'
        );
      } else if (result.reason === 'missing_project_id') {
        setError('Lipsește projectId EAS. Reinstalează aplicația din ultimul build.');
      } else if (
        result.reason?.toLowerCase().includes('google') ||
        result.reason?.toLowerCase().includes('firebase') ||
        result.reason?.toLowerCase().includes('fcm') ||
        result.reason?.toLowerCase().includes('google-services')
      ) {
        setError(result.reason);
      } else {
        setError(result.reason ?? 'Nu s-a putut înregistra token-ul push.');
      }
      void handleRefreshDiagnostics(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la înregistrarea push.');
    } finally {
      setPushBusy(false);
    }
  }

  async function handleStatusBarTest() {
    setPushTestBusy(true);
    setError(null);
    setMessage(null);
    try {
      const local = await presentStatusBarTestNotification();
      if (local.ok) {
        setMessage(
          `Test programat. Minimalizează app-ul ACUM — în ${local.delaySec ?? 5}s trebuie să vezi popup pe ecran (nu doar banner în app).`
        );
      } else if (local.reason === 'permission_denied') {
        setError('Permisiunea pentru notificări a fost refuzată. Activeaz-o din setările telefonului.');
      } else if (local.reason === 'channel_importance_low') {
        await openBookingChannelSettings();
        setError(
          'Canalul e pe importance mică. Activează „Pop on screen” / „Pe ecran” pentru „Cereri programări (popup)”, apoi reîncearcă testul.'
        );
      } else {
        setError(local.reason ?? 'Testul local a eșuat.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la testul din bara de status.');
    } finally {
      setPushTestBusy(false);
    }
  }

  async function handleOpenPopOnScreenSettings() {
    setError(null);
    setMessage(null);
    try {
      await openBookingChannelSettings();
      setMessage(
        'În ecranul Android: pe canalul „Cereri programări (popup)” activează „Pop on screen” / „Pe ecran” / „Afișare pe ecran”, apoi revino și rulează testul.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut deschide setările Android.');
    }
  }

  async function handleLogout() {
    setError(null);
    const { error: err } = await signOut();
    if (err) setError(err.message);
  }

  /** Verificare cap-coadă: ce lipsește ca popup-ul să vină și cu app-ul închis. */
  async function handleRefreshDiagnostics(silent = false) {
    if (!profile) return;
    if (!silent) {
      setDiagBusy(true);
      setError(null);
    }
    try {
      const d = await getPushDiagnostics(profile.id);
      setDiag(d);
      if (!silent) {
        if (
          d.permission !== 'granted' ||
          !d.channelOk ||
          (d.tokensInDb ?? 0) === 0 ||
          !d.projectIdPresent
        ) {
          setError(
            'Diagnostic push: ceva lipsește (vezi rândurile de mai jos). Apasă „Activează / reînregistrează notificările”, apoi verifică din nou.'
          );
        } else {
          setMessage('Diagnostic push: totul e OK. Popup-ul vine și cu aplicația închisă.');
        }
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Eroare la diagnostic push.');
    } finally {
      if (!silent) setDiagBusy(false);
    }
  }

  useEffect(() => {
    if (profile && !diag && !diagBusy) {
      void handleRefreshDiagnostics(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  if (loading) {
    return (
      <SkeletonScreen
        title="Setări"
        subtitle="Profil · OTA test 10.09"
        onBack={back}
        blocks={5}
        label="Se încarcă profilul…"
      />
    );
  }

  return (
    <Screen
      title="Setări"
      subtitle="Profil · OTA test 10.09"
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

      <SectionTitle>Notificări pe care le primești</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <SettingRow
          icon="alarm-outline"
          title="Reminder înainte de programare"
          description={
            notifyReminders
              ? 'Primești email/WhatsApp cu 24 de ore și cu 1 oră înainte.'
              : 'Nu primești reminder înainte de programare.'
          }
          right={
            <Toggle
              value={notifyReminders}
              onValueChange={setNotifyReminders}
              accessibilityLabel="Reminder înainte de programare"
            />
          }
        />
        <SettingRow
          icon="checkmark-circle-outline"
          title="Confirmare sau respingere"
          description={
            notifyDecision
              ? 'Primești mesaj când business-ul aprobă sau respinge cererea ta.'
              : 'Nu primești mesaj la aprobare sau respingere.'
          }
          right={
            <Toggle
              value={notifyDecision}
              onValueChange={setNotifyDecision}
              accessibilityLabel="Confirmare sau respingere"
            />
          }
        />
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          Salvează profilul pentru a aplica schimbările. WhatsApp necesită un număr valid mai sus.
        </Text>
      </View>

      <SectionTitle>Notificări push</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {Constants.appOwnership === 'expo' ? (
          <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
            Rulezi în Expo Go: notificările cu aplicația închisă nu funcționează aici
            (limită Expo Go, nu e o eroare). Primești vibrație + banner în app când vine
            o cerere nouă, cât timp app-ul e deschis. Pentru popup cu app-ul închis ai
            nevoie de build-ul nativ (APK pe Android / TestFlight pe iPhone).
          </Text>
        ) : null}
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          Ca popup-ul să vină și cu aplicația închisă complet, toate trebuie să fie ✅:
          permisiunea sistem, canalul popup, token înregistrat în baza de date și build
          APK cu Firebase (actualizarea OTA nu aduce Firebase).
        </Text>
        {diag ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.panelText, { color: t.colors.text }]}>
              {diag.permission === 'granted' ? '✅' : '❌'} Permisiune notificări: {diag.permission}
            </Text>
            <Text style={[styles.panelText, { color: t.colors.text }]}>
              {diag.channelOk ? '✅' : '❌'} Canal popup (Pop on screen):{' '}
              {diag.channelOk ? 'OK' : 'lipsește / importance mică'}
            </Text>
            <Text style={[styles.panelText, { color: t.colors.text }]}>
              {(diag.tokensInDb ?? 0) > 0 ? '✅' : '❌'} Token înregistrat în DB:{' '}
              {diag.tokensInDb == null ? 'necunoscut' : diag.tokensInDb}
            </Text>
            <Text style={[styles.panelText, { color: t.colors.text }]}>
              {diag.projectIdPresent ? '✅' : '❌'} Config EAS projectId:{' '}
              {diag.projectIdPresent ? 'OK' : 'lipsește — reinstalează din ultimul build'}
            </Text>
            {diag.isDevice === false ? (
              <Text style={[styles.panelText, { color: t.colors.text }]}>
                ❌ Rulezi pe simulator — push-ul merge doar pe telefon fizic.
              </Text>
            ) : null}
          </View>
        ) : null}
        <Button
          label={diagBusy ? 'Se verifică…' : 'Verifică status push'}
          variant="ghost"
          size="md"
          icon="checkmark-circle-outline"
          loading={diagBusy}
          disabled={diagBusy || pushBusy || pushTestBusy || !profile}
          onPress={() => void handleRefreshDiagnostics()}
        />
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          {Platform.OS === 'ios'
            ? 'Pe iPhone nu există „Pop on screen” — notificarea vine ca banner în partea de sus dacă ai permisiunile acordate (inclusiv „Time Sensitive”, dacă ți se cere). Dacă testul local apare dar cererile noi nu, lipsește cheia APNs în EAS sau build-ul e prea vechi.'
            : 'Cont business: cererea apare în app din baza de date; popup-ul pe ecran („Pop on screen”) e setare Android pe canalul de notificări — pe multe telefoane e oprit implicit.'}
          {'\n\n'}
          {Platform.OS === 'ios'
            ? 'Pași: 1) Activează notificările 2) „Test popup” și blochează ecranul imediat (5s) 3) Dacă testul local apare dar cererile noi nu, verifică cheia APNs în EAS și webhook-ul Supabase.'
            : 'Pași: 1) Activează notificările 2) „Deschide setări Pop on screen” → activează Pe ecran / Urgent 3) „Test popup” și minimalizează app-ul imediat (5s). Dacă testul local apare pe ecran dar cererile noi nu, verifică webhook-ul Supabase (notify-pending-push la INSERT pe appointments) și cheia FCM V1 pe EAS.'}
        </Text>
        <Button
          label={pushBusy ? 'Se înregistrează…' : 'Activează / reînregistrează notificările'}
          variant="secondary"
          size="md"
          icon="notifications-outline"
          loading={pushBusy}
          disabled={pushBusy || pushTestBusy || !profile}
          onPress={handleReregisterPush}
        />
        {Platform.OS === 'android' ? (
          <Button
            label="Deschide setări Pop on screen"
            variant="ghost"
            size="md"
            icon="settings-outline"
            disabled={pushBusy || pushTestBusy}
            onPress={handleOpenPopOnScreenSettings}
          />
        ) : null}
        <Button
          label={pushTestBusy ? 'Se trimite test…' : 'Test popup (minimalizează în 5s)'}
          variant="ghost"
          size="md"
          icon="phone-portrait-outline"
          loading={pushTestBusy}
          disabled={pushBusy || pushTestBusy}
          onPress={handleStatusBarTest}
        />
      </View>

      <SectionTitle>Tip cont</SectionTitle>
      <Card
        icon={appMode === 'business' ? 'storefront-outline' : 'person-outline'}
        title={appMode === 'business' ? 'Cont business' : 'Cont client'}
        hint={
          appMode === 'business'
            ? 'Agenda, cereri, clienți, echipă, QR și rapoarte. Pentru rezervări personale, creează un cont client separat.'
            : 'Rezervări și programările tale. Pentru salon, creează un cont business separat.'
        }
      />

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
