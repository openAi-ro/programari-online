import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';

/**
 * Player pentru video-ul de prezentare al business-ului.
 * Daca playerul nativ esueaza, ofera deschiderea linkului.
 */
export function PromoVideo({ videoUrl, title }: { videoUrl: string; title?: string }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
  });

  if (failed || !videoUrl) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Deschide video-ul de prezentare"
        onPress={() => {
          if (videoUrl) void Linking.openURL(videoUrl);
        }}
        style={({ pressed }) => [
          styles.fallback,
          {
            backgroundColor: t.colors.surfaceMuted,
            borderColor: t.colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons name="play-circle-outline" size={28} color={t.colors.accent} />
        <Text style={[styles.fallbackText, { color: t.colors.text }]}>
          {title ?? 'Vezi video-ul de prezentare'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: palette.ink950, borderColor: t.colors.border },
      ]}
    >
      <VideoView
        player={player}
        style={styles.video}
        contentFit="contain"
        nativeControls
        onFirstFrameRender={() => setFailed(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: 176,
  },
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
