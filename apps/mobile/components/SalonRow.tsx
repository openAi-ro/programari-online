import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Badge, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, radius, spacing } from '@/constants/theme';
import { formatBizHint } from '@/lib/discover';
import type { PublicBusiness } from '@/lib/discover';

export type SalonRowItem = PublicBusiness & { distanceKm?: number | null };

/**
 * Rand compact pentru listele de descoperire (Cauta hub + categorie).
 * Un singur rand per business: logo, nume, hint (oras · rating · distanta),
 * badge "Deschis acum" cand se cunoaste programul. Detaliile complete
 * (carte de vizita, video) raman pe ecranul de rezervare.
 */
export function SalonRow({
  item,
  openNow,
  onPress,
}: {
  item: SalonRowItem;
  openNow?: boolean | null;
  onPress: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const [imgFailed, setImgFailed] = useState(false);
  const showLogo = Boolean(item.logo_url) && !imgFailed;
  const hint = formatBizHint(item, { distanceKm: item.distanceKm ?? null });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={tr('browse.openBiz', { name: item.name })}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          opacity: pressed ? 0.88 : 1,
        },
        t.shadows.sm,
      ]}
    >
      <View style={[styles.logoWrap, { backgroundColor: t.colors.accentSoft }]}>
        {showLogo ? (
          <Image
            source={{ uri: item.logo_url as string }}
            style={styles.logo}
            onError={() => setImgFailed(true)}
            accessibilityLabel={tr('card.logoOf', { name: item.name })}
          />
        ) : (
          <Ionicons name="storefront-outline" size={22} color={t.colors.accent} />
        )}
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: t.colors.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        {hint ? (
          <Text style={[styles.rowHint, { color: t.colors.textMuted }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
        {openNow === true ? (
          <View style={styles.badgeRow}>
            <Badge tone="success" dot>
              {tr('browse.openNow')}
            </Badge>
          </View>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    minWidth: 0,
  },
  logoWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: { width: 48, height: 48, borderRadius: radius.md },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  rowHint: { fontSize: fontSize.sm, flexShrink: 1 },
  badgeRow: { flexDirection: 'row', marginTop: 2 },
});
