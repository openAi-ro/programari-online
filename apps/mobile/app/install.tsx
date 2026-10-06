import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { Button, Screen, useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import {
  getAndroidInstallUrl,
  getIosInstallUrl,
  isDirectFileUrl,
} from '@/lib/installLink';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isStandaloneDisplay(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    const mq = window.matchMedia?.('(display-mode: standalone)');
    if (mq?.matches) return true;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return Boolean(nav.standalone);
  } catch {
    return false;
  }
}

function firstParam(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

/** Pagină publică: PWA pe ecran + QR Android (APK) + QR iOS (PWA Safari). Fără cont. */
export default function InstallScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ platform?: string | string[] }>();
  const platformHint = (firstParam(params.platform) || '').toLowerCase();

  const androidUrl = useMemo(() => getAndroidInstallUrl(), []);
  const iosUrl = useMemo(() => getIosInstallUrl(), []);
  const androidDirect = isDirectFileUrl(androidUrl);

  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [pwaBusy, setPwaBusy] = useState(false);

  const highlightIos = platformHint === 'ios' || platformHint === 'iphone';
  const highlightAndroid = platformHint === 'android';

  // Dacă shortcut-ul de pe Home a fost adăugat de pe /install (icon „P”),
  // deschiderea e standalone pe pagina greșită — trimite-l în app.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!isStandaloneDisplay()) return;
    try {
      window.location.replace('/login');
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    setInstalled(isStandaloneDisplay());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onBip);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const onInstallPwa = useCallback(async () => {
    if (!deferred) return;
    setPwaBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setDeferred(null);
    } catch {
      // user dismissed / browser blocked
    } finally {
      setPwaBusy(false);
    }
  }, [deferred]);

  return (
    <Screen title="Instalează Programări" subtitle="Pe ecran · Android · iPhone">
      {/* A - PWA pe dispozitivul curent */}
      <View
        style={[
          styles.card,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: t.colors.text }]}>Instalează pe ecran</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          Adaugă Programări pe ecranul de start din Chrome (Android / PC) sau Safari (iPhone) —
          fără Magazin Play / App Store. Funcționează ca o aplicație, pe HTTPS.
        </Text>

        {installed ? (
          <Text style={[styles.ok, { color: palette.accent700 }]}>
            Aplicația este deja instalată pe acest dispozitiv.
          </Text>
        ) : deferred ? (
          <Button
            label={pwaBusy ? 'Se deschide…' : 'Instalează pe ecran'}
            icon="phone-portrait-outline"
            onPress={() => void onInstallPwa()}
          />
        ) : (
          <View style={styles.steps}>
            <Text style={[styles.step, { color: t.colors.text }]}>
              Android (Chrome): meniu ⋮ → „Adaugă pe ecranul de start” / „Instalează aplicația”.
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              iPhone (Safari): buton Partajează → „Pe ecranul Home”.
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              Windows (Chrome): pictograma Instalare din bara de adrese, sau meniu → „Instalează
              Programări…”.
            </Text>
          </View>
        )}
      </View>

      {/* B - QR Android (sus) */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: t.colors.surface,
            borderColor: highlightAndroid ? palette.accent700 : t.colors.border,
            borderWidth: highlightAndroid ? 2 : 1,
          },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: t.colors.text }]}>
          Descarcă aplicația Android
        </Text>
        <View style={styles.qrInner}>
          <QRCode
            value={androidUrl}
            size={200}
            backgroundColor={palette.white}
            color={palette.ink950}
          />
        </View>
        <Text style={[styles.qrCaption, { color: t.colors.text }]}>Scanează pentru Android</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {androidDirect
            ? 'Scanează QR-ul sau apasă butonul, descarcă fișierul APK și deschide-l ca să instalezi. După instalare, creează un cont.'
            : 'Scanează QR-ul pe telefonul Android sau apasă butonul, descarcă fișierul și deschide-l ca să instalezi. După instalare, creează un cont.'}
        </Text>
        <Button
          label={androidDirect ? 'Descarcă fișierul APK' : 'Descarcă aplicația Android'}
          icon="logo-android"
          onPress={() => void Linking.openURL(androidUrl)}
        />
      </View>

      {/* C - QR iOS PWA (sub Android) */}
      <View
        style={[
          styles.card,
          {
            backgroundColor: t.colors.surface,
            borderColor: highlightIos ? palette.accent700 : t.colors.border,
            borderWidth: highlightIos ? 2 : 1,
          },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: t.colors.text }]}>
          Descarcă aplicația iOS
        </Text>
        <View style={styles.qrInner}>
          <QRCode value={iosUrl} size={200} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.qrCaption, { color: t.colors.text }]}>Scanează pentru iPhone</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          Pe iPhone nu există APK. QR-ul deschide ecranul de login în Safari. Acolo: Partajează
          → „Pe ecranul Home” / „Add to Home Screen”. Nu adăuga pe Home pagina de instalare —
          adaugă ecranul de login, ca să pornească aplicația.
        </Text>
        {highlightIos ? (
          <View style={styles.steps}>
            <Text style={[styles.step, { color: t.colors.text }]}>
              1. Șterge de pe Home iconița veche cu „P” (ține apăsat → Șterge bookmark).
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              2. Deschide linkul în Safari (nu Chrome). Trebuie să vezi login-ul Programări.
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              3. Partajează (pătrat cu săgeată) → „Pe ecranul Home” → Adaugă. Nume: Programări.
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              4. Deschide iconița nouă de pe Home — trebuie să apară login/acasa, nu această pagină.
            </Text>
          </View>
        ) : null}
        <Button
          label="Deschide login în Safari"
          icon="logo-apple"
          onPress={() => void Linking.openURL(iosUrl)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    alignSelf: 'stretch',
    textAlign: 'left',
  },
  qrInner: {
    padding: spacing.md,
    backgroundColor: palette.white,
    borderRadius: radius.md,
  },
  qrCaption: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
  hint: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center' },
  ok: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center' },
  steps: { gap: spacing.sm, alignSelf: 'stretch' },
  step: { fontSize: fontSize.sm, lineHeight: 20 },
});