import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { extractPublicCode } from '@/lib/bookingLink';
import { useBack } from '@/lib/nav';

/**
 * Camera chrome: intentional dark overlay (palette.ink950) so the finder
 * stays high-contrast regardless of light/dark app theme. Non-camera chrome
 * (manual code sheet) uses useTheme tokens.
 */
export default function ScanScreen() {
  const t = useTheme();
  const router = useRouter();
  const back = useBack();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState('');

  function goToBook(code: string) {
    setLocked(true);
    // push (nu replace): păstrăm Acasă/Scan în istoric ca să existe buton Înapoi
    router.push(`/(app)/book/${code}` as never);
  }

  function onBarcode({ data }: { data: string }) {
    if (locked) return;
    const code = extractPublicCode(data);
    if (!code) {
      setHint('QR invalid. Aștept link /b/…, book/… sau programari://b/…');
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
        <Ionicons name="camera-outline" size={28} color={palette.white} />
        <Text style={styles.centerText}>Se încarcă camera…</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.colors.bg }]}>
      {permission.granted ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={locked ? undefined : onBarcode}
        />
      ) : (
        <View style={styles.center}>
          <View style={styles.centerIcon}>
            <Ionicons name="scan-outline" size={30} color={palette.white} />
          </View>
          <Text style={styles.centerText}>
            Camera nu are permisiunea încă. Poți oricând să introduci codul business
            mai jos, fără cameră.
          </Text>
          <Button
            label="Permite camera"
            icon="camera-outline"
            onPress={requestPermission}
            fullWidth={false}
          />
        </View>
      )}

      {permission.granted ? (
        <View style={styles.frame} pointerEvents="none">
          <View style={[styles.frameBox, { borderColor: 'rgba(255,255,255,0.75)' }]} />
          <Text style={styles.frameHint}>Alinează codul QR în interiorul cadrului</Text>
        </View>
      ) : null}

      <View style={[styles.backWrap, { top: insets.top + spacing.sm }]}>
        <Pressable
          onPress={back}
          accessibilityRole="button"
          accessibilityLabel="Închide scanarea"
          hitSlop={4}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name="close" size={20} color={palette.white} />
        </Pressable>
      </View>

      <View
        style={[
          styles.overlay,
          {
            backgroundColor: t.colors.bgElevated,
            borderTopColor: t.colors.border,
            paddingBottom: insets.bottom + spacing.lg,
          },
        ]}
      >
        <Text style={[styles.overlayTitle, { color: t.colors.text }]}>
          Scanează codul QR sau introdu codul
        </Text>
        <Field
          value={manual}
          onChangeText={setManual}
          placeholder="Cod business"
          icon="keypad-outline"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={onManual}
        />
        <Button
          label="Deschide programarea"
          icon="arrow-forward"
          onPress={onManual}
        />
        {hint ? (
          <View style={styles.hintRow}>
            <Ionicons name="alert-circle-outline" size={14} color={t.colors.warning} />
            <Text style={[styles.hint, { color: t.colors.warningSoftText }]}>{hint}</Text>
          </View>
        ) : null}
        {locked ? (
          <Pressable
            onPress={() => setLocked(false)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.retry,
              { opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name="refresh" size={14} color={t.colors.accent} />
            <Text style={[styles.retryText, { color: t.colors.accent }]}>Scanează din nou</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['2xl'],
    gap: spacing.lg,
    backgroundColor: palette.ink950,
  },
  centerIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', // on ink950 camera chrome
  },
  centerText: {
    textAlign: 'center',
    color: palette.ink200,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  frame: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameBox: {
    width: 232,
    height: 232,
    borderRadius: radius.xl,
    borderWidth: 3,
  },
  frameHint: {
    marginTop: spacing.md,
    color: 'rgba(255,255,255,0.85)',
    fontSize: fontSize.sm,
    fontWeight: '600',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  backWrap: {
    position: 'absolute',
    left: spacing.md,
  },
  backBtn: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,17,32,0.55)',
  },
  overlay: {
    padding: spacing.lg,
    gap: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  overlayTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hint: { flex: 1, minWidth: 0, fontSize: fontSize.sm, lineHeight: 18 },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  retryText: { fontSize: fontSize.sm, fontWeight: '700' },
});
