import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

function extractPublicCode(raw: string): string | null {
  const value = raw.trim();
  // programari://b/CODE
  const scheme = value.match(/^programari:\/\/b\/([a-z0-9]+)/i);
  if (scheme?.[1]) return scheme[1];
  // https://.../b/CODE or any path with /b/CODE
  const path = value.match(/\/b\/([a-z0-9]+)/i);
  if (path?.[1]) return path[1];
  // bare code
  if (/^[a-z0-9]{6,20}$/i.test(value)) return value.toLowerCase();
  return null;
}

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text>Se încarcă camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          Avem nevoie de acces la cameră pentru a scana codul QR.
        </Text>
        <Pressable style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Permite camera</Text>
        </Pressable>
      </View>
    );
  }

  function onBarcode({ data }: { data: string }) {
    if (locked) return;
    const code = extractPublicCode(data);
    if (!code) {
      setHint('QR invalid. Aștept programari://b/…');
      return;
    }
    setLocked(true);
    router.replace(`/(app)/book/${code}`);
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={locked ? undefined : onBarcode}
      />
      <View style={styles.overlay}>
        <Text style={styles.overlayText}>Îndreaptă camera spre QR-ul business-ului</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {locked ? (
          <Pressable style={styles.button} onPress={() => setLocked(false)}>
            <Text style={styles.buttonText}>Scanează din nou</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  text: { textAlign: 'center', marginBottom: 16, color: '#334155' },
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    alignItems: 'center',
  },
  overlayText: {
    color: '#fff',
    fontSize: 15,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 8,
  },
  hint: { color: '#fbbf24', marginTop: 8 },
  button: {
    marginTop: 12,
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
});
