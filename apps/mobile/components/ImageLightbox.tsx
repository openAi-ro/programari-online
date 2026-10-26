import { Image, Modal, Pressable, StyleSheet } from 'react-native';

/** Previzualizare pe tot ecranul a unei imagini; atingerea oriunde sau butonul Înapoi o închide. */
export function ImageLightbox({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  return (
    <Modal visible={uri !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button">
        {uri ? (
          <Image
            source={{ uri }}
            style={styles.img}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  img: { width: '100%', height: '100%' },
});
