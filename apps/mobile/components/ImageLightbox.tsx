import { Ionicons } from '@expo/vector-icons';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/lib/i18n';

/**
 * Previzualizare pe tot ecranul a unei imagini. Se închide la atingerea fundalului
 * (sau a imaginii), cu butonul X ori cu Înapoi pe Android.
 */
export function ImageLightbox({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const tr = useT();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={uri !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr('common.close')}
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={styles.img}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          ) : null}
        </Pressable>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={tr('common.close')}
          hitSlop={8}
          style={[styles.close, { top: insets.top + 12 }]}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
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
