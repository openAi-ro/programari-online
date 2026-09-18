import { useMemo, useState } from 'react';
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

function normalizeTimeInput(raw: string): string {
  const digits = raw.replace(/[^\d]/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidHhMm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Compact HH:MM input styled like Field (theme border/focus). */
function TimeChip({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  accessibilityLabel?: string;
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
      onChangeText={(v) => onChangeText(normalizeTimeInput(v))}
      placeholder={placeholder}
      placeholderTextColor={t.colors.textFaint}
      maxLength={5}
      keyboardType="numbers-and-punctuation"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

function LabeledTimeBox({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.labeledBox}>
      <Text style={[styles.boxLabel, { color: t.colors.textMuted }]}>{label}</Text>
      <TextInput
        style={[
          styles.boxInput,
          {
            backgroundColor: t.colors.bgElevated,
            borderColor: focused ? t.colors.accent : t.colors.borderStrong,
            color: t.colors.text,
            minHeight: spacing.touchTarget,
          },
        ]}
        value={value}
        onChangeText={(v) => onChangeText(normalizeTimeInput(v))}
        placeholder={placeholder}
        placeholderTextColor={t.colors.textFaint}
        maxLength={5}
        keyboardType="numbers-and-punctuation"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function WorkingHoursForm({ value, onChange }: Props) {
  const t = useTheme();

  const defaultFromOpen = useMemo(() => {
    const open = DAY_LABELS.map(({ key }) => value[key]).find((d) => !d.closed);
    return {
      start: open && !open.closed ? open.start : '09:00',
      end: open && !open.closed ? open.end : '17:00',
    };
  }, [value]);

  const [bulkStart, setBulkStart] = useState(defaultFromOpen.start);
  const [bulkEnd, setBulkEnd] = useState(defaultFromOpen.end);

  function updateDay(key: DayKey, day: DayHours) {
    onChange({ ...value, [key]: day });
  }

  function toggleClosed(key: DayKey) {
    const current = value[key];
    if (current.closed) {
      updateDay(key, {
        closed: false,
        start: isValidHhMm(bulkStart) ? bulkStart : '09:00',
        end: isValidHhMm(bulkEnd) ? bulkEnd : '17:00',
      });
    } else {
      updateDay(key, { closed: true });
    }
  }

  function applyBulkHours() {
    const start = isValidHhMm(bulkStart) ? bulkStart : null;
    const end = isValidHhMm(bulkEnd) ? bulkEnd : null;
    if (!start || !end) return;
    if (start >= end) return;
    const next: WorkingHours = { ...value };
    for (const { key } of DAY_LABELS) {
      if (!next[key].closed) {
        next[key] = { closed: false, start, end };
      }
    }
    onChange(next);
  }

  const bulkOk = isValidHhMm(bulkStart) && isValidHhMm(bulkEnd) && bulkStart < bulkEnd;

  return (
    <View style={styles.wrap}>
      <SectionTitle>Program de lucru</SectionTitle>

      <View
        style={[
          styles.configCard,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <Text style={[styles.configTitle, { color: t.colors.text }]}>
          Ore de început și sfârșit
        </Text>
        <Text style={[styles.configHint, { color: t.colors.textMuted }]}>
          Setează intervalul, apoi aplică-l pe toate zilele deschise. Poți ajusta apoi pe fiecare zi.
        </Text>
        <View style={styles.configRow}>
          <LabeledTimeBox
            label="Ora început"
            value={bulkStart}
            onChangeText={setBulkStart}
            placeholder="09:00"
          />
          <LabeledTimeBox
            label="Ora sfârșit"
            value={bulkEnd}
            onChangeText={setBulkEnd}
            placeholder="17:00"
          />
        </View>
        <Pressable
          onPress={applyBulkHours}
          disabled={!bulkOk}
          accessibilityRole="button"
          accessibilityLabel="Aplică orele pe zilele deschise"
          style={({ pressed }) => [
            styles.applyBtn,
            {
              backgroundColor: bulkOk ? t.colors.accent : t.colors.surfaceMuted,
              opacity: pressed && bulkOk ? 0.85 : 1,
              minHeight: spacing.touchTarget,
            },
          ]}
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={18}
            color={bulkOk ? t.colors.onAccent : t.colors.textFaint}
          />
          <Text
            style={[
              styles.applyBtnText,
              { color: bulkOk ? t.colors.onAccent : t.colors.textFaint },
            ]}
          >
            Aplică pe zilele deschise
          </Text>
        </Pressable>
        {!bulkOk ? (
          <Text style={[styles.configError, { color: t.colors.danger }]}>
            Folosește format HH:MM (ex. 09:00–17:00), cu început înainte de sfârșit.
          </Text>
        ) : null}
      </View>

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
                  <View style={styles.timeCol}>
                    <Text style={[styles.miniLabel, { color: t.colors.textFaint }]}>Început</Text>
                    <TimeChip
                      value={day.start}
                      onChangeText={(start) =>
                        updateDay(key, { closed: false, start, end: day.end })
                      }
                      placeholder="09:00"
                      accessibilityLabel={`Ora început ${label}`}
                    />
                  </View>
                  <Text style={[styles.dash, { color: t.colors.textFaint }]}>–</Text>
                  <View style={styles.timeCol}>
                    <Text style={[styles.miniLabel, { color: t.colors.textFaint }]}>Sfârșit</Text>
                    <TimeChip
                      value={day.end}
                      onChangeText={(end) =>
                        updateDay(key, { closed: false, start: day.start, end })
                      }
                      placeholder="17:00"
                      accessibilityLabel={`Ora sfârșit ${label}`}
                    />
                  </View>
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
          const start = isValidHhMm(bulkStart) ? bulkStart : '09:00';
          const end = isValidHhMm(bulkEnd) ? bulkEnd : '17:00';
          for (const { key } of DAY_LABELS) {
            all[key] = anyOpen ? { closed: true } : { closed: false, start, end };
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
  configCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  configTitle: { fontSize: fontSize.md, fontWeight: '700' },
  configHint: { fontSize: fontSize.sm, lineHeight: 18 },
  configRow: { flexDirection: 'row', gap: spacing.md },
  labeledBox: { flex: 1, gap: 6 },
  boxLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase' },
  boxInput: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  applyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  applyBtnText: { fontSize: fontSize.sm, fontWeight: '700' },
  configError: { fontSize: fontSize.xs, lineHeight: 16 },
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
  times: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  timeCol: { gap: 2, alignItems: 'center' },
  miniLabel: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
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
  dash: { fontSize: fontSize.sm, marginBottom: 10 },
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
