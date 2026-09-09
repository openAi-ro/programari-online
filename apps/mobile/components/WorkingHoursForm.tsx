import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { SectionTitle, Toggle, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
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

/** Compact HH:MM input styled like Field (theme border/focus). */
function TimeChip({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[
        styles.timeInput,
        {
          backgroundColor: t.colors.surface,
          borderColor: focused ? t.colors.accent : t.colors.borderStrong,
          color: t.colors.text,
          minHeight: spacing.touchTarget - 8,
        },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={t.colors.textFaint}
      maxLength={5}
      keyboardType="numbers-and-punctuation"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export function WorkingHoursForm({ value, onChange }: Props) {
  const t = useTheme();

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
      <SectionTitle>Program de lucru</SectionTitle>
      <View
        style={[
          styles.panel,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        {DAY_LABELS.map(({ key, label }, index) => {
          const day = value[key];
          return (
            <View
              key={key}
              style={[
                styles.row,
                {
                  borderBottomColor: t.colors.border,
                  borderBottomWidth: index === DAY_LABELS.length - 1 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={styles.dayBlock}>
                <Text style={[styles.dayLabel, { color: day.closed ? t.colors.textFaint : t.colors.text }]}>
                  {label}
                </Text>
                <View style={styles.dayHintRow}>
                  <Ionicons
                    name={day.closed ? 'moon-outline' : 'sunny-outline'}
                    size={12}
                    color={day.closed ? t.colors.textFaint : t.colors.success}
                  />
                  <Text
                    style={[
                      styles.dayHint,
                      { color: day.closed ? t.colors.textFaint : t.colors.textMuted },
                    ]}
                  >
                    {day.closed ? 'Închis' : 'Deschis'}
                  </Text>
                </View>
              </View>

              {!day.closed ? (
                <View style={styles.times}>
                  <TimeChip
                    value={day.start}
                    onChangeText={(start) =>
                      updateDay(key, { closed: false, start, end: day.end })
                    }
                    placeholder="09:00"
                  />
                  <Text style={[styles.dash, { color: t.colors.textFaint }]}>–</Text>
                  <TimeChip
                    value={day.end}
                    onChangeText={(end) =>
                      updateDay(key, { closed: false, start: day.start, end })
                    }
                    placeholder="17:00"
                  />
                </View>
              ) : (
                <Text style={[styles.closedText, { color: t.colors.textFaint }]}>—</Text>
              )}

              <Toggle
                value={!day.closed}
                onValueChange={() => toggleClosed(key)}
                accessibilityLabel={`Deschide sau închide ${label}`}
              />
            </View>
          );
        })}
      </View>
      <Pressable
        onPress={() => {
          const all: WorkingHours = { ...value };
          const anyOpen = DAY_LABELS.some(({ key }) => !value[key].closed);
          for (const { key } of DAY_LABELS) {
            all[key] = anyOpen ? { closed: true } : { closed: false, start: '09:00', end: '17:00' };
          }
          onChange(all);
        }}
        accessibilityRole="button"
        hitSlop={6}
        style={({ pressed }) => [
          styles.quickAction,
          {
            borderColor: t.colors.borderStrong,
            opacity: pressed ? 0.7 : 1,
            minHeight: spacing.touchTarget,
          },
        ]}
      >
        <Ionicons name="flash-outline" size={14} color={t.colors.accent} />
        <Text style={[styles.quickActionText, { color: t.colors.accent }]}>
          {DAY_LABELS.some(({ key }) => !value[key].closed)
            ? 'Închide toate zilele'
            : 'Deschide toate zilele'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  panel: {
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  dayBlock: { flex: 1, gap: 2 },
  dayLabel: { fontSize: fontSize.md, fontWeight: '600' },
  dayHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayHint: { fontSize: fontSize.xs },
  times: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  timeInput: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    width: 66,
    textAlign: 'center',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  dash: { fontSize: fontSize.sm },
  closedText: { width: 72, textAlign: 'right', fontSize: fontSize.md },
  quickAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  quickActionText: { fontSize: fontSize.sm, fontWeight: '700' },
});
