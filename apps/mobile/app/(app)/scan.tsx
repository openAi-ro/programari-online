import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { extractPublicCode } from '@/lib/bookingLink';

export default function ScanScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  function goToBook(code: string) {
    setLocked(true);
    router.replace(`/(app)/book/${code}` as any);
  }

  function onBarcode({ data }: { data: string }) {
    if (locked) return;
    const code = extractPublicCode(data);
    if (!code) {
      setHint('QR invalid. Aștept link book/… sau programari://b/…');
      return;
    }
    goToBook(code);
  }

  function onManual() {
    const code = extractPublicCode(manual.trim());
    if (!code) {
      setHint('Introdu codul business (ex. din ecranul QR).');
      return;
    }
    goToBook(code);
  }

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text>Se încarcă camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {permission.granted ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={locked ? undefined : onBarcode}
        />
      ) : (
        <View style={styles.center}>
          <Text style={styles.text}>
            Pentru scanare cu camera, permite accesul. Poți și introduce codul manual.
          </Text>
          <Pressable style={styles.button} onPress={requestPermission}>
            <Text style={styles.buttonText}>Permite camera</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.overlay}>
        <Text style={styles.overlayText}>
          Scanează QR-ul SAU introdu codul business mai jos
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Cod business"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          value={manual}
          onChangeText={setManual}
        />
        <Pressable style={styles.button} onPress={onManual}>
          <Text style={styles.buttonText}>Deschide programarea</Text>
        </Pressable>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {locked ? (
          <Pressable style={styles.buttonOutline} onPress={() => setLocked(false)}>
            <Text style={styles.buttonOutlineText}>Scanează din nou</Text>
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
    backgroundColor: '#0f172a',
  },
  text: { textAlign: 'center', marginBottom: 16, color: '#e2e8f0' },
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingBottom: 36,
    backgroundColor: 'rgba(15,23,42,0.92)',
  },
  overlayText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  hint: { color: '#fbbf24', marginTop: 8, textAlign: 'center' },
  button: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonOutline: {
    marginTop: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonOutlineText: { color: '#93c5fd' },
});
