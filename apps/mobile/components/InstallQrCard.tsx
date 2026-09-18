import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Clipboard from 'expo-clipboard';

import { Button, useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { getInstallUrl, isDirectFileUrl } from '@/lib/installLink';

export function InstallQrCard() {
  const t = useTheme();
  const url = getInstallUrl();
  const direct = isDirectFileUrl(url);
  const [copied, setCopied] = useState(false);

  async function copy() {
    await Clipboard.setStringAsync(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        t.shadows.md,
      ]}
    >
      <Text style={[styles.title, { color: t.colors.text }]}>Descarcă aplicația</Text>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {direct
          ? 'Nu ai aplicația? Scanează cu camera telefonului — se descarcă direct fișierul de instalare.'
          : 'Nu ai aplicația? Scanează cu camera telefonului ca să o instalezi.'}
      </Text>
      <View style={styles.qrInner}>
        <QRCode value={url} size={168} backgroundColor={palette.white} color={palette.ink950} />
      </View>
      <View style={styles.actions}>
        <View style={styles.action}>
          <Button
            label={direct ? 'Descarcă fișierul' : 'Deschide link'}
            variant="secondary"
            size="md"
            icon="download-outline"
            onPress={() => void Linking.openURL(url)}
          />
        </View>
        <View style={styles.action}>
          <Button
            label={copied ? 'Copiat' : 'Copiază'}
            variant="secondary"
            size="md"
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={() => void copy()}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginTop: spacing.xl,
  },
  title: { fontSize: fontSize.md, fontWeight: '800', textAlign: 'center' },
  hint: { fontSize: fontSize.sm, lineHeight: 19, textAlign: 'center' },
  qrInner: {
    padding: spacing.md,
    backgroundColor: palette.white,
    borderRadius: radius.md,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  action: { flex: 1 },
});
