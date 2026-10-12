import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { Button, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import {
  getAndroidInstallUrl,
  getIosInstallUrl,
  isDirectFileUrl,
} from '@/lib/installLink';

export function InstallQrCard() {
  const t = useTheme();
  const tr = useT();
  const androidUrl = getAndroidInstallUrl();
  const iosUrl = getIosInstallUrl();
  const androidDirect = isDirectFileUrl(androidUrl);
  const [copiedAndroid, setCopiedAndroid] = useState(false);
  const [copiedIos, setCopiedIos] = useState(false);

  async function copyAndroid() {
    await Clipboard.setStringAsync(androidUrl);
    setCopiedAndroid(true);
    setTimeout(() => setCopiedAndroid(false), 2000);
  }

  async function copyIos() {
    await Clipboard.setStringAsync(iosUrl);
    setCopiedIos(true);
    setTimeout(() => setCopiedIos(false), 2000);
  }

  return (
    <View style={styles.wrap}>
      {/* Android — sus */}
      <View
        style={[
          styles.card,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          t.shadows.md,
        ]}
      >
        <Text style={[styles.title, { color: t.colors.text }]}>{tr('install.androidTitle')}</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {androidDirect ? tr('install.androidApk') : tr('install.androidStore')}
        </Text>
        <View style={styles.qrInner}>
          <QRCode
            value={androidUrl}
            size={168}
            backgroundColor={palette.white}
            color={palette.ink950}
          />
        </View>
        <Text style={[styles.caption, { color: t.colors.text }]}>{tr('install.scanAndroid')}</Text>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={androidDirect ? tr('install.downloadApk') : tr('install.openLink')}
              variant="secondary"
              size="md"
              icon="logo-android"
              onPress={() => void Linking.openURL(androidUrl)}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={copiedAndroid ? tr('install.copied') : tr('install.copy')}
              variant="secondary"
              size="md"
              icon={copiedAndroid ? 'checkmark' : 'copy-outline'}
              onPress={() => void copyAndroid()}
            />
          </View>
        </View>
      </View>

      {/* iOS — dedesubt, cu pași */}
      <View
        style={[
          styles.card,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          t.shadows.md,
        ]}
      >
        <Text style={[styles.title, { color: t.colors.text }]}>{tr('install.iosTitle')}</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {tr('install.iosHint')}
        </Text>
        <View style={styles.qrInner}>
          <QRCode value={iosUrl} size={168} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.caption, { color: t.colors.text }]}>{tr('install.scanIphone')}</Text>

        <View style={styles.steps}>
          <Text style={[styles.stepsTitle, { color: t.colors.text }]}>{tr('install.iosSteps')}</Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            {tr('install.iosStep1')}
          </Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            {tr('install.iosStep2')}
          </Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            {tr('install.iosStep3')}
          </Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            {tr('install.iosStep4')}
          </Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={tr('install.openSafariLogin')}
              variant="secondary"
              size="md"
              icon="logo-apple"
              onPress={() => void Linking.openURL(iosUrl)}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={copiedIos ? tr('install.copied') : tr('install.copy')}
              variant="secondary"
              size="md"
              icon={copiedIos ? 'checkmark' : 'copy-outline'}
              onPress={() => void copyIos()}
            />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, marginTop: spacing.xl, width: '100%' },
  card: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    width: '100%',
  },
  title: { fontSize: fontSize.md, fontWeight: '800', textAlign: 'center', alignSelf: 'stretch' },
  hint: { fontSize: fontSize.sm, lineHeight: 19, textAlign: 'center' },
  caption: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center' },
  qrInner: {
    padding: spacing.md,
    backgroundColor: palette.white,
    borderRadius: radius.md,
  },
  steps: { alignSelf: 'stretch', gap: spacing.sm, marginTop: spacing.xs },
  stepsTitle: { fontSize: fontSize.sm, fontWeight: '800', marginBottom: spacing.xs },
  step: { fontSize: fontSize.sm, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  action: { flex: 1 },
});