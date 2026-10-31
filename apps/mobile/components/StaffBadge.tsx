import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import { trKey } from '@/lib/i18n';

type Props = {
  name: string;
  photoUrl?: string | null;
  color?: string;
  size?: number;
  selected?: boolean;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Badge rotund cu poza specialistului si numele la baza imaginii.
 * Poza umple tot cercul (fara inel colorat deasupra). Daca nu exista poza
 * sau nu se incarca, arata initialele pe fundalul culorii specialistului.
 */
export function StaffBadge({ name, photoUrl, color, size = 72, selected }: Props) {
  const t = useTheme();
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showPhoto = Boolean(photoUrl) && failedUri !== photoUrl;
  return (
    <View style={[styles.wrap, { width: size + spacing.md * 2 }]}>
      <View
        style={[
          styles.circle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: selected ? t.colors.accent : t.colors.borderStrong,
            backgroundColor: showPhoto ? t.colors.surfaceMuted : (color ?? t.colors.surface),
          },
        ]}
      >
        {showPhoto ? (
          <Image
            source={{ uri: photoUrl as string }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            accessibilityLabel={trKey('staff.photoOf', { name })}
            onError={() => setFailedUri(photoUrl as string)}
          />
        ) : (
          <Text style={[styles.fallback, { fontSize: size * 0.32 }]}>{initials(name)}</Text>
        )}
      </View>
      <Text
        style={[styles.name, { color: t.colors.text }]}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 6, paddingHorizontal: spacing.md },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    overflow: 'hidden',
  },
  fallback: { color: palette.white, fontWeight: '700' },
  name: { fontSize: fontSize.sm, fontWeight: '600', textAlign: 'center', lineHeight: 17 },
});

export function staffBadgeRadius(): number {
  return radius.pill;
}
