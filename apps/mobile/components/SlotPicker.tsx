import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  if (slots.length === 0) {
    return <Text style={styles.empty}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const selected = slot.startUtc === selectedStartUtc;
        return (
          <Pressable
            key={slot.startUtc}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => onSelect(slot)}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
              {slot.labelLocal}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  chipSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  chipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  chipTextSelected: {
    color: '#fff',
  },
  empty: {
    color: '#64748b',
    fontSize: 14,
    marginTop: 8,
  },
});
