import { Ionicons } from '@expo/vector-icons';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, radius, spacing } from '@/constants/theme';

/** Business row with optional favorite heart — avoids extending shared Card API. */
export function BizCardRow({
  title,
  hint,
  favorited,
  onPress,
  onToggleFavorite,
  heart = true,
}: {
  title: string;
  hint?: string;
  favorited?: boolean;
  onPress: () => void;
  onToggleFavorite?: () => void;
  heart?: boolean;
}) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
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
      <View style={[styles.icon, { backgroundColor: t.colors.accentSoft }]}>
        <Ionicons name="storefront-outline" size={20} color={t.colors.accent} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: t.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {hint ? (
          <Text style={[styles.hint, { color: t.colors.textMuted }]} numberOfLines={2}>
            {hint}
          </Text>
        ) : null}
      </View>
      {heart && onToggleFavorite ? (
        <Pressable
          onPress={() => onToggleFavorite()}
          hitSlop={8}
          // Web: cardul e deja <button>; inima ca al doilea <button> imbricat da eroare de HTML.
          accessibilityRole={Platform.OS === 'web' ? undefined : 'button'}
          accessibilityLabel={favorited ? tr('fav.remove') : tr('fav.add')}
          style={styles.heartBtn}
        >
          <Ionicons
            name={favorited ? 'heart' : 'heart-outline'}
            size={22}
            color={favorited ? t.colors.danger : t.colors.textFaint}
          />
        </Pressable>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    minWidth: 0,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  hint: { fontSize: fontSize.sm, flexShrink: 1 },
  heartBtn: { padding: 4 },
});
