import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import type { FreeSlot } from '@/lib/types';

type Props = {
  slots: FreeSlot[];
  selectedStartUtc?: string | null;
  onSelect: (slot: FreeSlot) => void;
  emptyLabel?: string;
};

export function SlotPicker({
  slots,
  selectedStartUtc,
  onSelect,
  emptyLabel = 'Nu există sloturi libere în această zi.',
}: Props) {
  const t = useTheme();

  if (slots.length === 0) {
    return (
      <EmptyState
        icon="time-outline"
        title="Niciun slot liber"
        description={emptyLabel}
        compact
      />
    );
  }

  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const selected = slot.startUtc === selectedStartUtc;
        return (
          <Pressable
            key={slot.startUtc}
            onPress={() => onSelect(slot)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? t.colors.accent : t.colors.surface,
                borderColor: selected ? t.colors.accent : t.colors.borderStrong,
                transform: [{ scale: pressed ? 0.96 : 1 }],
                minHeight: spacing.touchTarget,
              },
              selected ? t.shadows.accent : null,
            ]}
          >
            <Text
              style={[
                styles.chipText,
                { color: selected ? t.colors.onAccent : t.colors.text },
              ]}
            >
              {slot.labelLocal}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minWidth: 82,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md + 1,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: fontSize.md, fontWeight: '700' },
});
