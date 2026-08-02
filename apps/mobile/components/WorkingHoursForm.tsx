import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DayHours, DayKey, WorkingHours } from '@/lib/types';

const DAY_LABELS: { key: DayKey; label: string }[] = [
  { key: 'mon', label: 'Luni' },
  { key: 'tue', label: 'Marți' },
  { key: 'wed', label: 'Miercuri' },
  { key: 'thu', label: 'Joi' },
  { key: 'fri', label: 'Vineri' },
  { key: 'sat', label: 'Sâmbătă' },
  { key: 'sun', label: 'Duminică' },
];

type Props = {
  value: WorkingHours;
  onChange: (next: WorkingHours) => void;
};

export function WorkingHoursForm({ value, onChange }: Props) {
  function updateDay(key: DayKey, day: DayHours) {
    onChange({ ...value, [key]: day });
  }

  function toggleClosed(key: DayKey) {
    const current = value[key];
    if (current.closed) {
      updateDay(key, { closed: false, start: '09:00', end: '17:00' });
    } else {
      updateDay(key, { closed: true });
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Program de lucru</Text>
      {DAY_LABELS.map(({ key, label }) => {
        const day = value[key];
        return (
          <View key={key} style={styles.row}>
            <Pressable style={styles.dayToggle} onPress={() => toggleClosed(key)}>
              <Text style={styles.dayLabel}>{label}</Text>
              <Text style={styles.closedHint}>{day.closed ? 'Închis' : 'Deschis'}</Text>
            </Pressable>
            {!day.closed ? (
              <View style={styles.times}>
                <TextInput
                  style={styles.timeInput}
                  value={day.start}
                  onChangeText={(start) =>
                    updateDay(key, { closed: false, start, end: day.end })
                  }
                  placeholder="09:00"
                  maxLength={5}
                />
                <Text style={styles.dash}>–</Text>
                <TextInput
                  style={styles.timeInput}
                  value={day.end}
                  onChangeText={(end) =>
                    updateDay(key, { closed: false, start: day.start, end })
                  }
                  placeholder="17:00"
                  maxLength={5}
                />
              </View>
            ) : (
              <Text style={styles.closedText}>—</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 8 },
  heading: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e5e5',
  },
  dayToggle: { flex: 1 },
  dayLabel: { fontSize: 15, fontWeight: '500' },
  closedHint: { fontSize: 12, color: '#666', marginTop: 2 },
  times: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 72,
    textAlign: 'center',
    backgroundColor: '#fafafa',
  },
  dash: { color: '#666' },
  closedText: { color: '#999', width: 100, textAlign: 'right' },
});
