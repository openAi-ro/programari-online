import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useT } from '@/lib/i18n';
import type { ChatAttachmentKind } from '@/lib/mediaKeys';

/**
 * Web: browser <img>/<video>. The video thumbnail is the first frame ("#t=0.1",
 * preload="metadata" fetches only the header). Phone: ChatMedia.tsx.
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
        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <>
          <video
            src={`${url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
          />
          <View style={styles.playBadge} pointerEvents="none">
            <Ionicons name="play-circle" size={48} color="#fff" />
          </View>
        </>
      )}
    </Pressable>
  );
}

export function ChatMediaViewer({
  media,
  onClose,
}: {
  media: { kind: ChatAttachmentKind; url: string } | null;
  onClose: () => void;
}) {
  const tr = useT();
  return (
    <Modal visible={media != null} animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={styles.backdrop}>
        {media?.kind === 'image' ? (
          <img src={media.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : media?.kind === 'video' ? (
          <video
            src={media.url}
            controls
            autoPlay
            playsInline
            style={{ maxWidth: '100%', maxHeight: '100%', backgroundColor: '#000' }}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr('common.close')}
          onPress={onClose}
          style={styles.close}
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
  playBadge: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  close: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
