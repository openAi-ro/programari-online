import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { avatarColor, clientInitials } from '@/lib/clientAvatar';

const SIZE = 64;

/**
 * Cercul clientului pe cardul din Cereri: poza de profil dacă are cont și poză,
 * altfel inițialele pe o culoare stabilă, altfel o iconiță. Poza care nu se încarcă → inițiale.
 */
export function ClientAvatar({ uri, name, seed }: { uri: string | null; name: string | null; seed: string }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  const initials = clientInitials(name);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={[styles.circle, { backgroundColor: t.colors.surfaceMuted }]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
    );
  }
  if (initials) {
    return (
      <View style={[styles.circle, { backgroundColor: avatarColor(seed || initials) }]} accessible={false}>
        <Text style={styles.initials} numberOfLines={1}>
          {initials}
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.circle, { backgroundColor: t.colors.surfaceMuted, borderColor: t.colors.border, borderWidth: 1 }]} accessible={false}>
      <Ionicons name="person-outline" size={28} color={t.colors.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { color: '#ffffff', fontSize: 22, fontWeight: '800' },
});
