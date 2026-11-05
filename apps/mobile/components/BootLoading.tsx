import { StyleSheet, Text, View } from 'react-native';

import { PageLoader } from '@/components/PageLoader';
import { trKey } from '@/lib/i18n';

/**
 * Ecran de pornire (boot): loaderul Programări (12 bare + iconița în centru),
 * pe fundal #f1f5f9, aceeași culoare ca splash-ul nativ. Splash-ul nativ este
 * static, deci animația rulează aici, imediat după ce splash-ul se ascunde.
 */
export function BootLoading({ label, sublabel }: { label?: string; sublabel?: string }) {
  return (
    <View style={styles.screen}>
      <PageLoader size={120} accessibilityLabel={label ?? trKey('common.loading')} />

      {label ? <Text style={styles.label}>{label}</Text> : null}
      {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 32,
  },
  label: {
    marginTop: 24,
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
