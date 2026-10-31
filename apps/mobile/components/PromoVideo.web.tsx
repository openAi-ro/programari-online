import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, palette, radius, spacing } from '@/constants/theme';

/**
 * Web: <video> nativ al browserului (controale, ecran complet, sunet incluse).
 * preload="metadata" descarca doar antetul, nu tot fisierul (2-28 MB), pana la Play.
 * Fara poster, "#t=0.1" face browserul sa afiseze primul cadru ca miniatura.
 * Pe telefon: PromoVideo.tsx (expo-video).
 */
export function PromoVideo({
  videoUrl,
  title,
  poster,
}: {
  videoUrl: string;
  title?: string;
  poster?: string | null;
}) {
  const t = useTheme();
  const tr = useT();
  const [failed, setFailed] = useState(false);

  if (failed || !videoUrl) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tr('video.openPromo')}
        onPress={() => {
          if (videoUrl) void Linking.openURL(videoUrl);
        }}
        style={({ pressed }) => [
          styles.fallback,
          { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Ionicons name="play-circle-outline" size={28} color={t.colors.accent} />
        <Text style={[styles.fallbackText, { color: t.colors.text }]}>{title ?? tr('video.watchPromo')}</Text>
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: palette.ink950, borderColor: t.colors.border }]}>
      <video
        src={poster ? videoUrl : `${videoUrl}#t=0.1`}
        poster={poster ?? undefined}
        controls
        preload="metadata"
        playsInline
        aria-label={title ? `${tr('video.play')}: ${title}` : tr('video.play')}
        onError={() => setFailed(true)}
        style={{ display: 'block', width: '100%', height: 220, objectFit: 'contain', backgroundColor: palette.ink950 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  fallback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  fallbackText: { fontSize: fontSize.sm, fontWeight: '700', flexShrink: 1 },
});
