import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, radius, spacing } from '@/constants/theme';

/** Butoane spre rețelele firmei, pe pagina publică de rezervare. */
export function SocialButtons({
  instagramUrl,
  facebookUrl,
  tone = 'dark',
}: {
  instagramUrl?: string | null;
  facebookUrl?: string | null;
  tone?: 'dark' | 'light';
}) {
  const t = useTheme();
  const tr = useT();
  const links = [
    instagramUrl ? { label: 'Instagram', icon: 'logo-instagram' as const, url: instagramUrl } : null,
    facebookUrl ? { label: 'Facebook', icon: 'logo-facebook' as const, url: facebookUrl } : null,
  ].filter((l): l is NonNullable<typeof l> => l !== null);
  if (links.length === 0) return null;
  const color = tone === 'dark' ? t.colors.accentSoftText : t.colors.text;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color }]}>{tr('book.followUs')}</Text>
      <View style={styles.row}>
        {links.map((l) => (
          <Pressable
            key={l.label}
            accessibilityRole="link"
            accessibilityLabel={l.label}
            onPress={() => void Linking.openURL(l.url)}
            style={({ pressed }) => [
              styles.btn,
              { borderColor: tone === 'dark' ? color : t.colors.border, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Ionicons name={l.icon} size={16} color={color} />
            <Text style={[styles.label, { color }]}>{l.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  title: { fontSize: fontSize.sm, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: { fontSize: fontSize.sm, fontWeight: '700' },
});
