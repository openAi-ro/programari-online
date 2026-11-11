import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { SlotPicker } from '@/components/SlotPicker';
import { useTheme } from '@/components/ui';
import { fontSize, palette, radius, spacing } from '@/constants/theme';
import type { FreeSlot, Staff } from '@/lib/types';

const AVATAR = 40;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * „Oricine disponibil”: calendarul unui singur specialist, cu numele lui deasupra.
 * `children` = selectorul de zi (pagina publică); orele afișate sunt doar ale lui.
 */
export function StaffSlotsCard({
  member,
  slots,
  loading,
  selectedStartUtc,
  onSelect,
  emptyLabel,
  error,
  children,
}: {
  member: Staff;
  slots: FreeSlot[];
  loading: boolean;
  selectedStartUtc?: string | null;
  onSelect: (slot: FreeSlot) => void;
  emptyLabel?: string;
  /** Orele nu s-au putut citi: se arată eroarea, nu „Niciun slot liber” (retest 3.26). */
  error?: string | null;
  children?: ReactNode;
}) {
  const t = useTheme();
  const [photoFailed, setPhotoFailed] = useState<string | null>(null);
  const photo = member.photo_url && photoFailed !== member.photo_url ? member.photo_url : null;
  const specialty = member.specialty?.trim();
  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
      accessibilityLabel={member.name}
    >
      <View style={styles.header}>
        {photo ? (
          <Image
            source={{ uri: photo }}
            style={styles.avatar}
            onError={() => setPhotoFailed(photo)}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[styles.avatar, { backgroundColor: member.color || t.colors.accent }]}>
            <Text style={styles.initials}>{initialsOf(member.name)}</Text>
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={[styles.name, { color: t.colors.text }]} numberOfLines={2} accessibilityRole="header">
            {member.name}
          </Text>
          {specialty ? (
            <Text style={[styles.specialty, { color: t.colors.textMuted }]} numberOfLines={1}>
              {specialty}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={t.colors.accent} />
        </View>
      ) : error ? (
        <Text style={[styles.specialty, { color: t.colors.danger }]} accessibilityRole="alert">
          {error}
        </Text>
      ) : (
        <SlotPicker
          slots={slots}
          selectedStartUtc={selectedStartUtc}
          onSelect={onSelect}
          emptyLabel={emptyLabel}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: { color: palette.white, fontWeight: '700', fontSize: fontSize.sm },
  headerText: { flex: 1, minWidth: 0 },
  name: { fontSize: fontSize.md, fontWeight: '700' },
  specialty: { fontSize: fontSize.sm },
  loading: { paddingVertical: spacing.lg, alignItems: 'center' },
});
