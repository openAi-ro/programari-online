import { StyleSheet, Text, View } from 'react-native';

import { PageLoader } from '@/components/PageLoader';
import { trKey } from '@/lib/i18n';

/** Latura loaderului de pornire; iconița din centru are 38/80 din ea (57 dp), ca `imageWidth` din app.json. */
const BOOT_LOADER_SIZE = 120;

/**
 * Ecran de pornire (boot): loaderul Programări (12 bare + iconița în centru),
 * pe fundal #f1f5f9, exact peste logo-ul splash-ului nativ (aceeași culoare,
 * aceeași poziție, aceeași mărime). Textul opțional stă dedesubt, fără să mute loaderul.
 */
export function BootLoading({
  label,
  sublabel,
  onLogoLoadEnd,
}: {
  label?: string;
  sublabel?: string;
  onLogoLoadEnd?: () => void;
}) {
  return (
    <View style={styles.screen} pointerEvents="none">
      <PageLoader
        size={BOOT_LOADER_SIZE}
        accessibilityLabel={label ?? trKey('common.loading')}
        onLogoLoadEnd={onLogoLoadEnd}
      />

      {label ? (
        <View style={styles.labels}>
          <Text style={styles.label}>{label}</Text>
          {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  labels: {
    position: 'absolute',
    top: '50%',
    left: 32,
    right: 32,
    marginTop: BOOT_LOADER_SIZE / 2 + 24,
    alignItems: 'center',
  },
  label: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  sublabel: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 13,
    textAlign: 'center',
  },
});
