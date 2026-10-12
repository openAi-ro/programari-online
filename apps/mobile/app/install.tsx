import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { Button, Screen, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
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
  const tr = useT();
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
    <Screen title={tr('inst.title')} subtitle={tr('inst.subtitle')}>
      {/* A - PWA pe dispozitivul curent */}
      <View
        style={[
          styles.card,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: t.colors.text }]}>{tr('inst.onScreen')}</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {tr('inst.pwaHint')}
        </Text>

        {installed ? (
          <Text style={[styles.ok, { color: palette.accent700 }]}>
            {tr('inst.installed')}
          </Text>
        ) : deferred ? (
          <Button
            label={pwaBusy ? tr('inst.opening') : tr('inst.onScreen')}
            icon="phone-portrait-outline"
            onPress={() => void onInstallPwa()}
          />
        ) : (
          <View style={styles.steps}>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.stepAndroid')}
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.stepIphone')}
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.stepWindows')}
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
          {tr('inst.android')}
        </Text>
        <View style={styles.qrInner}>
          <QRCode
            value={androidUrl}
            size={200}
            backgroundColor={palette.white}
            color={palette.ink950}
          />
        </View>
        <Text style={[styles.qrCaption, { color: t.colors.text }]}>{tr('inst.scanAndroid')}</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {androidDirect ? tr('inst.apkDirect') : tr('inst.apkStore')}
        </Text>
        <Button
          label={androidDirect ? tr('inst.dlApk') : tr('inst.dlAndroid')}
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
          {tr('inst.ios')}
        </Text>
        <View style={styles.qrInner}>
          <QRCode value={iosUrl} size={200} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.qrCaption, { color: t.colors.text }]}>{tr('inst.scanIphone')}</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {tr('inst.iosHint')}
        </Text>
        {highlightIos ? (
          <View style={styles.steps}>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.ios1')}
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.ios2')}
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.ios3')}
            </Text>
            <Text style={[styles.step, { color: t.colors.text }]}>
              {tr('inst.ios4')}
            </Text>
          </View>
        ) : null}
        <Button
          label={tr('inst.openLogin')}
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