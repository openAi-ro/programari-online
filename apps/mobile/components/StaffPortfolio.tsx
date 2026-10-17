import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { normalizePortfolioUrls } from '@/lib/staffPortfolio';
import { useT } from '@/lib/i18n';

/** Galerie de lucrări ale specialistului, vizibilă la rezervare. */
export function StaffPortfolio({
  urls,
  name,
}: {
  urls: readonly string[] | null | undefined;
  name: string;
}) {
  const t = useTheme();
  const tr = useT();
  const photos = normalizePortfolioUrls(urls);
  const [active, setActive] = useState(0);
  if (photos.length === 0) return null;
  const current = photos[Math.min(active, photos.length - 1)];

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: t.colors.textMuted }]}>
        {tr('book.worksOf', { name })}
      </Text>
      <Image
        source={{ uri: current }}
        style={[styles.main, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}
        accessibilityLabel={tr('book.workPhoto', { name })}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {photos.map((uri, i) => (
          <Pressable
            key={uri}
            onPress={() => setActive(i)}
            accessibilityRole="button"
            accessibilityState={{ selected: i === active }}
            accessibilityLabel={tr('book.workPhoto', { name })}
            style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
          >
            <Image
              source={{ uri }}
              style={[
                styles.thumb,
                {
                  borderColor: i === active ? t.colors.accent : t.colors.border,
                  borderWidth: i === active ? 2 : 1,
                },
              ]}
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: { fontSize: fontSize.sm, fontWeight: '700' },
  main: { width: '100%', height: 220, borderRadius: radius.lg, borderWidth: 1 },
  row: { gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
});
