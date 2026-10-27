import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/lib/i18n';
import type { ChatAttachmentKind } from '@/lib/mediaKeys';

/**
 * Chat photo/video on the phone. Thumbnail in the bubble; tap opens a full-screen
 * viewer (photo) or player (expo-video with native controls).
 * Web: ChatMedia.web.tsx.
 */
export function ChatAttachmentThumb({
  kind,
  url,
  onOpen,
}: {
  kind: ChatAttachmentKind;
  url: string | null;
  onOpen: () => void;
}) {
  const tr = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={kind === 'video' ? tr('chat.openVideoA11y') : tr('chat.openPhotoA11y')}
      onPress={onOpen}
      disabled={!url}
      style={styles.thumb}
    >
      {!url ? (
        <ActivityIndicator color="#fff" />
      ) : kind === 'image' ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <Ionicons name="play-circle" size={48} color="#fff" />
      )}
    </Pressable>
  );
}

function FullVideo({ url }: { url: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={styles.full} contentFit="contain" nativeControls />;
}

export function ChatMediaViewer({
  media,
  onClose,
}: {
  media: { kind: ChatAttachmentKind; url: string } | null;
  onClose: () => void;
}) {
  const tr = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={media != null} animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={styles.backdrop}>
        {media?.kind === 'image' ? (
          <Image source={{ uri: media.url }} style={styles.full} resizeMode="contain" />
        ) : media?.kind === 'video' ? (
          <FullVideo url={media.url} />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('common.close')}
          onPress={onClose}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: 200,
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  full: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
