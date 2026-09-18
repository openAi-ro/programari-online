import { Linking, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Button, Screen, useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { getInstallUrl, isDirectFileUrl } from '@/lib/installLink';

/** Pagină publică: scanare din cameră / browser, fără cont. */
export default function InstallScreen() {
  const t = useTheme();
  const url = getInstallUrl();
  const direct = isDirectFileUrl(url);

  return (
    <Screen title="Instalează Programări" subtitle="Pentru telefoane fără aplicație">
      <View
        style={[
          styles.card,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.qrInner}>
          <QRCode value={url} size={200} backgroundColor={palette.white} color={palette.ink950} />
        </View>
        <Text style={[styles.hint, { color: t.colors.textMuted }]}>
          {direct
            ? 'Apasă butonul de mai jos, descarcă fișierul și deschide-l ca să instalezi. După instalare, deschide aplicația și creează un cont.'
            : 'Pe Android, apasă butonul de mai jos, descarcă fișierul și deschide-l ca să instalezi. După instalare, deschide aplicația și creează un cont.'}
        </Text>
        <Button
          label={direct ? 'Descarcă fișierul' : 'Descarcă aplicația'}
          icon="download-outline"
          onPress={() => void Linking.openURL(url)}
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
  },
  qrInner: {
    padding: spacing.md,
    backgroundColor: palette.white,
    borderRadius: radius.md,
  },
  hint: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center' },
});
