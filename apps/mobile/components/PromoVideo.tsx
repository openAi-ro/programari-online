import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEvent, useEventListener } from 'expo';
import { VideoView, useVideoPlayer } from 'expo-video';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, palette, radius, spacing } from '@/constants/theme';

/**
 * Player pentru video-ul de prezentare al business-ului.
 * Daca playerul nativ esueaza, ofera deschiderea linkului.
 *
 * Overlay-ul (fundal intunecat + buton central) e al nostru, nu controalele
 * native: cele native (web/Android/iOS) isi tin scrim-ul peste video si dupa
 * Play, iar momentul ascunderii nu e controlabil. Aici overlay-ul depinde doar
 * de starea playerului: dispare cand ruleaza, revine (replay) la final.
 */
export function PromoVideo({ videoUrl, title }: { videoUrl: string; title?: string }) {
  const t = useTheme();
  const tr = useT();
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const [ended, setEnded] = useState(false);
  useEventListener(player, 'playToEnd', () => setEnded(true));

  const start = () => {
    if (ended) {
      setEnded(false);
      player.replay();
    } else {
      player.play();
    }
  };

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
          {
            backgroundColor: t.colors.surfaceMuted,
            borderColor: t.colors.border,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Ionicons name="play-circle-outline" size={28} color={t.colors.accent} />
        <Text style={[styles.fallbackText, { color: t.colors.text }]}>
          {title ?? tr('video.watchPromo')}
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
        nativeControls={false}
        playsInline
        onFirstFrameRender={() => setFailed(false)}
      />
      {isPlaying ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('video.pause')}
          onPress={() => player.pause()}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ended ? tr('video.replay') : tr('video.play')}
          onPress={start}
          style={[StyleSheet.absoluteFill, styles.overlay]}
        >
          <View style={styles.playCircle}>
            <Ionicons name={ended ? 'refresh' : 'play'} size={30} color="#FFFFFF" />
          </View>
        </Pressable>
      )}
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
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
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
