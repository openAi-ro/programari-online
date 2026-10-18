import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/components/ui';

/** Eticheta unui contor: 1..99, apoi "99+". */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * Contor rosu peste iconita unui tab. Ancorat la stanga (pe mijlocul iconitei
 * de 22px) ca sa creasca spre dreapta in interiorul tab-ului, nu peste marginea
 * ecranului. Textul nu se scaleaza cu fontul sistemului, ca sa nu iasa din cerc.
 */
export function TabCountBadge({ count }: { count: number }) {
  const t = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.tab, { backgroundColor: t.colors.danger }]} pointerEvents="none">
      <Text style={styles.tabText} numberOfLines={1} allowFontScaling={false}>
        {formatBadgeCount(count)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    position: 'absolute',
    top: -4,
    left: 14,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  tabText: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    textAlign: 'center',
    includeFontPadding: false,
  },
});
