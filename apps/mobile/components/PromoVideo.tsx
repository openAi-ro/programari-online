import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEvent, useEventListener } from 'expo';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, palette, radius, spacing } from '@/constants/theme';

/**
 * Player pentru video-ul de prezentare al business-ului (telefon; pe web: PromoVideo.web.tsx).
 * Daca playerul nativ esueaza, ofera deschiderea linkului.
 *
 * Overlay-ul (fundal intunecat + buton central) e al nostru, nu controalele
 * native: cele native (Android/iOS) isi tin scrim-ul peste video si dupa
 * Play, iar momentul ascunderii nu e controlabil. Aici overlay-ul depinde doar
 * de starea playerului: dispare cand ruleaza, revine (replay) la final.
 *
 * Ecran complet: Modal propriu cu acelasi player, buton X
 * (inchide) si sunet on/off, in zona sigura. Cat timp e deschis, VideoView-ul
 * din card e demontat, ca playerul sa se reataseze curat la inchidere.
 * La comutare se pastreaza pozitia si starea (ruleaza/pauza), reaplicate prin API-ul playerului.
 */
type Resume = { t: number; play: boolean } | null;

function ResumeOnMount({ player, resume }: { player: VideoPlayer; resume: MutableRefObject<Resume> }) {
  useEffect(() => {
    const r = resume.current;
    if (!r) return;
    resume.current = null;
    player.currentTime = r.t;
    if (r.play) player.play();
    // ruleaza o data, imediat dupa montarea VideoView-ului frate (efectele fratilor anteriori ruleaza inainte)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Până la tap nu creăm playerul: fără player nu se descarcă nimic (video-urile au
 * 2–28 MB). Afișăm un „poster” cu buton Play; la tap montăm playerul și pornim.
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
  const [active, setActive] = useState(false);
  if (active || !videoUrl) {
    return <PromoVideoPlayer videoUrl={videoUrl} title={title} />;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title ? `${tr('video.play')}: ${title}` : tr('video.play')}
      onPress={() => setActive(true)}
      style={[styles.wrap, { backgroundColor: palette.ink950, borderColor: t.colors.border }]}
    >
      {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={[styles.video, styles.overlay, styles.poster]}>
        <View style={styles.playCircle}>
          <Ionicons name="play" size={30} color={palette.white} />
        </View>
        {title ? (
          <Text style={styles.posterTitle} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function PromoVideoPlayer({ videoUrl, title }: { videoUrl: string; title?: string }) {
  const t = useTheme();
  const tr = useT();
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Montat doar după tap pe poster → pornește direct.
  const player = useVideoPlayer(videoUrl, (p) => {
    p.loop = false;
    p.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
  const [ended, setEnded] = useState(false);
  useEventListener(player, 'playToEnd', () => setEnded(true));
  const resume = useRef<Resume>(null);
  const switchFullscreen = (next: boolean) => {
    resume.current = ended ? null : { t: player.currentTime, play: player.playing };
    setFullscreen(next);
  };

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
      {fullscreen ? (
        <View style={styles.video} />
      ) : (
        <>
          <VideoView
            player={player}
            style={styles.video}
            contentFit="contain"
            nativeControls={false}
            playsInline
            onFirstFrameRender={() => setFailed(false)}
          />
          <ResumeOnMount player={player} resume={resume} />
          <PlayOverlay player={player} isPlaying={isPlaying} ended={ended} onStart={start} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('video.fullscreen')}
            onPress={() => switchFullscreen(true)}
            hitSlop={8}
            style={[styles.iconBtn, styles.expandBtn]}
          >
            <Ionicons name="expand" size={18} color={palette.white} />
          </Pressable>
        </>
      )}
      <Modal
        visible={fullscreen}
        animationType="fade"
        presentationStyle="fullScreen"
        statusBarTranslucent
        supportedOrientations={['portrait', 'landscape']}
        onRequestClose={() => switchFullscreen(false)}
      >
        {/* Demontat imediat la inchidere (nu dupa animatia Modal-ului), ca <video>-ul
            din ecran complet sa nu mai poata pune pe pauza video-ul din card. */}
        {fullscreen ? (
          <FullscreenBody
            player={player}
            isPlaying={isPlaying}
            ended={ended}
            muted={muted}
            onStart={start}
            onClose={() => switchFullscreen(false)}
            resume={resume}
          />
        ) : null}
      </Modal>
    </View>
  );
}

function PlayOverlay({
  player,
  isPlaying,
  ended,
  onStart,
}: {
  player: VideoPlayer;
  isPlaying: boolean;
  ended: boolean;
  onStart: () => void;
}) {
  const tr = useT();
  return isPlaying ? (
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
      onPress={onStart}
      style={[StyleSheet.absoluteFill, styles.overlay]}
    >
      <View style={styles.playCircle}>
        <Ionicons name={ended ? 'refresh' : 'play'} size={30} color={palette.white} />
      </View>
    </Pressable>
  );
}

function FullscreenBody({
  player,
  isPlaying,
  ended,
  muted,
  onStart,
  onClose,
  resume,
}: {
  player: VideoPlayer;
  isPlaying: boolean;
  ended: boolean;
  muted: boolean;
  onStart: () => void;
  onClose: () => void;
  resume: MutableRefObject<Resume>;
}) {
  const tr = useT();
  const insets = useSafeAreaInsets();
  const top = Math.max(insets.top, spacing.md);
  return (
    <View style={styles.fsRoot}>
      <VideoView
        player={player}
        style={styles.fsVideo}
        contentFit="contain"
        nativeControls={false}
        playsInline
      />
      <ResumeOnMount player={player} resume={resume} />
      <PlayOverlay player={player} isPlaying={isPlaying} ended={ended} onStart={onStart} />
      <View
        pointerEvents="box-none"
        style={[
          styles.fsBar,
          { top, left: Math.max(insets.left, spacing.md), right: Math.max(insets.right, spacing.md) },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muted ? tr('video.unmute') : tr('video.mute')}
          onPress={() => {
            player.muted = !player.muted;
          }}
          hitSlop={8}
          style={styles.fsBtn}
        >
          <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={24} color={palette.white} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('video.closeFullscreen')}
          onPress={onClose}
          hitSlop={8}
          style={styles.fsBtn}
        >
          <Ionicons name="close" size={26} color={palette.white} />
        </Pressable>
      </View>
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
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  expandBtn: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
  },
  fsRoot: {
    flex: 1,
    backgroundColor: palette.ink950,
  },
  fsVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
  fsBar: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fsBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
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
  poster: { gap: spacing.sm, paddingHorizontal: spacing.md },
  posterTitle: { color: palette.white, fontSize: fontSize.sm, fontWeight: '700' },
});