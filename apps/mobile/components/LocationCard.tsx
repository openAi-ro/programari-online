import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  buildDriveUrl,
  buildMapsUrl,
  buildNativeDriveUrl,
  buildNativeMapsUrl,
  formatAddress,
  hasCoordinates,
  openMaps,
  type BusinessLocation,
} from '@/lib/location';

type Props = {
  location: BusinessLocation;
  /** Afișează doar rândul compact, fără padding mare. */
  compact?: boolean;
};

/**
 * Card cu adresa business-ului.
 * Dacă există coordonate GPS → „Condu acum” (navigare).
 * Altfel, dacă există adresă/link → „Deschide pe hartă”.
 */
export function LocationCard({ location, compact = false }: Props) {
  const t = useTheme();
  const address = formatAddress(location);
  const mapsUrl = buildMapsUrl(location);
  const nativeMapsUrl = buildNativeMapsUrl(location);
  const driveUrl = buildDriveUrl(location);
  const nativeDriveUrl = buildNativeDriveUrl(location);
  const canDrive = hasCoordinates(location) && Boolean(driveUrl);

  if (!address && !mapsUrl && !canDrive) return null;

  const title = address ?? 'Vezi locația pe hartă';

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          padding: compact ? spacing.md : spacing.lg,
        },
        t.shadows.sm,
      ]}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: t.colors.infoSoft }]}>
          <Ionicons name="location" size={20} color={t.colors.info} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: t.colors.text }]}>{title}</Text>
          <Text style={[styles.hint, { color: t.colors.textMuted }]}>
            {canDrive
              ? 'Coordonate GPS salvate — poți porni navigarea acum.'
              : address
                ? 'Deschide harta pentru indicații de orientare.'
                : 'Locația nu are adresă completă.'}
          </Text>
        </View>
      </View>

      {canDrive ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Condu acum"
          onPress={() => void openMaps(driveUrl, nativeDriveUrl)}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: t.colors.accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="navigate" size={16} color={t.colors.onAccent} />
          <Text style={[styles.actionText, { color: t.colors.onAccent }]}>Condu acum</Text>
        </Pressable>
      ) : mapsUrl ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Deschide locația pe hartă"
          onPress={() => void openMaps(mapsUrl, nativeMapsUrl)}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: t.colors.accent,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Ionicons name="map-outline" size={16} color={t.colors.onAccent} />
          <Text style={[styles.actionText, { color: t.colors.onAccent }]}>Deschide pe hartă</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.md, fontWeight: '700' },
  hint: { fontSize: fontSize.sm, lineHeight: 18 },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: spacing.touchTarget,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  actionText: { fontSize: fontSize.md, fontWeight: '700' },
});
