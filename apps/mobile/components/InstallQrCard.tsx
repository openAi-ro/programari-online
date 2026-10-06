import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { Button, useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import {
  getAndroidInstallUrl,
  getIosInstallUrl,
  isDirectFileUrl,
} from '@/lib/installLink';

export function InstallQrCard() {
  const t = useTheme();
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
        <Text style={[styles.title, { color: t.colors.text }]}>Descarcă aplicația Android</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {androidDirect
            ? 'Scanează cu camera telefonului Android — se descarcă fișierul APK de instalare.'
            : 'Scanează cu camera telefonului Android ca să descarci și să instalezi aplicația.'}
        </Text>
        <View style={styles.qrInner}>
          <QRCode
            value={androidUrl}
            size={168}
            backgroundColor={palette.white}
            color={palette.ink950}
          />
        </View>
        <Text style={[styles.caption, { color: t.colors.text }]}>Scanează pentru Android</Text>
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={androidDirect ? 'Descarcă APK' : 'Deschide link'}
              variant="secondary"
              size="md"
              icon="logo-android"
              onPress={() => void Linking.openURL(androidUrl)}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={copiedAndroid ? 'Copiat' : 'Copiază'}
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
        <Text style={[styles.title, { color: t.colors.text }]}>Descarcă aplicația iOS</Text>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          Pe iPhone: QR-ul deschide login-ul în Safari. Adaugă pe Home DE ACOLO (nu de pe pagina
          de instalare), altfel apare iconița „P” și aplicația nu pornește.
        </Text>
        <View style={styles.qrInner}>
          <QRCode value={iosUrl} size={168} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.caption, { color: t.colors.text }]}>Scanează pentru iPhone</Text>

        <View style={styles.steps}>
          <Text style={[styles.stepsTitle, { color: t.colors.text }]}>Pași instalare iOS</Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            1. Deschide în Safari — trebuie să vezi ecranul de login Programări.
          </Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            2. Partajează (pătrat cu săgeată în sus).
          </Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            3. „Pe ecranul Home” / „Add to Home Screen” → Adaugă (nume: Programări).
          </Text>
          <Text style={[styles.step, { color: t.colors.text }]}>
            4. Șterge iconița veche cu „P” dacă există. Deschide iconița nouă.
          </Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label="Deschide login Safari"
              variant="secondary"
              size="md"
              icon="logo-apple"
              onPress={() => void Linking.openURL(iosUrl)}
            />
          </View>
          <View style={styles.action}>
            <Button
              label={copiedIos ? 'Copiat' : 'Copiază'}
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