import { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, radius, spacing } from '@/constants/theme';

type Props = {
  /** HH:MM (24h) */
  value: string;
  onChange: (hhmm: string) => void;
  label?: string;
  accessibilityLabel?: string;
  placeholder?: string;
  /** Small chip for the per-day rows; default is a full-width field like Field. */
  compact?: boolean;
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const pad = (n: number) => String(n).padStart(2, '0');

function parseHhMm(v: string): { h: number; m: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v);
  return match ? { h: Number(match[1]), m: Number(match[2]) } : null;
}

function toDate({ h, m }: { h: number; m: number }): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Time field: a tap opens a picker, there is no typing. Being a Pressable, a swipe that
 * starts on it scrolls the page instead of focusing an input and opening the keyboard.
 * Android: native clock dialog. iOS: spinner in a bottom sheet. Web: hour/minute grid sheet.
 */
export function TimePickerField({
  value,
  onChange,
  label,
  accessibilityLabel,
  placeholder = '09:00',
  compact = false,
}: Props) {
  const t = useTheme();
  const tr = useT();
  const [open, setOpen] = useState(false);
  const parsed = parseHhMm(value);
  const initial = parsed ?? parseHhMm(placeholder) ?? { h: 9, m: 0 };
  const [draft, setDraft] = useState(initial);

  // Keep an off-grid saved minute (e.g. 07) selectable on web.
  const minutes = useMemo(
    () => (MINUTES.includes(draft.m) ? MINUTES : [...MINUTES, draft.m].sort((a, b) => a - b)),
    [draft.m]
  );

  function openPicker() {
    setDraft(initial);
    setOpen(true);
  }

  function commit(next: { h: number; m: number }) {
    onChange(`${pad(next.h)}:${pad(next.m)}`);
  }

  function onAndroidChange(event: DateTimePickerEvent, selected?: Date) {
    setOpen(false);
    if (event.type === 'set' && selected) commit({ h: selected.getHours(), m: selected.getMinutes() });
  }

  const field = (
    <Pressable
      onPress={openPicker}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        compact ? styles.chip : styles.field,
        {
          backgroundColor: t.colors.surface,
          borderColor: open || pressed ? t.colors.accent : t.colors.borderStrong,
          opacity: pressed ? 0.85 : 1,
          minHeight: compact ? spacing.touchTarget - 8 : spacing.touchTarget,
        },
      ]}
    >
      {!compact ? <Ionicons name="time-outline" size={17} color={t.colors.accent} /> : null}
      <Text
        style={[
          compact ? styles.chipText : styles.fieldText,
          { color: parsed ? t.colors.text : t.colors.textFaint },
        ]}
        numberOfLines={1}
      >
        {parsed ? value : placeholder}
      </Text>
    </Pressable>
  );

  const sheet = (children: React.ReactNode, onDone: () => void) => (
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <View style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} accessibilityLabel={tr('common.close')} />
        <View style={[styles.modalCard, { backgroundColor: t.colors.bgElevated }, t.shadows.lg]}>
          <View style={styles.modalBar}>
            <View style={[styles.modalGrabber, { backgroundColor: t.colors.borderStrong }]} />
          </View>
          <Text style={[styles.modalTitle, { color: t.colors.text }]}>
            {label ?? accessibilityLabel ?? tr('pick.timeTitle')}
          </Text>
          {children}
          <Pressable
            accessibilityRole="button"
            onPress={onDone}
            style={({ pressed }) => [
              styles.modalBtn,
              { backgroundColor: t.colors.accent, opacity: pressed ? 0.85 : 1, minHeight: spacing.touchTarget },
            ]}
          >
            <Text style={[styles.modalBtnText, { color: t.colors.onAccent }]}>{tr('pick.done')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  const cell = (text: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={text}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.cell,
        {
          backgroundColor: selected ? t.colors.accent : t.colors.surface,
          borderColor: selected ? t.colors.accent : t.colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.cellText, { color: selected ? t.colors.onAccent : t.colors.text }]}>{text}</Text>
    </Pressable>
  );

  return (
    <View style={compact ? undefined : styles.wrap}>
      {label && !compact ? (
        <Text style={[styles.label, { color: t.colors.textMuted }]}>{label}</Text>
      ) : null}
      {field}

      {open && Platform.OS === 'android' ? (
        <DateTimePicker value={toDate(initial)} mode="time" is24Hour onChange={onAndroidChange} />
      ) : null}

      {Platform.OS === 'ios'
        ? sheet(
            <DateTimePicker
              value={toDate(draft)}
              mode="time"
              display="spinner"
              is24Hour
              locale="ro-RO"
              onChange={(_e, selected) => {
                if (selected) setDraft({ h: selected.getHours(), m: selected.getMinutes() });
              }}
              style={{ alignSelf: 'center' }}
            />,
            () => {
              commit(draft);
              setOpen(false);
            }
          )
        : null}

      {Platform.OS === 'web'
        ? sheet(
            <View style={styles.gridWrap}>
              <Text style={[styles.gridLabel, { color: t.colors.textMuted }]}>{tr('pick.hours')}</Text>
              <View style={styles.grid}>
                {HOURS.map((h) => cell(pad(h), h === draft.h, () => setDraft((d) => ({ ...d, h }))))}
              </View>
              <Text style={[styles.gridLabel, { color: t.colors.textMuted }]}>{tr('pick.minutes')}</Text>
              <View style={styles.grid}>
                {minutes.map((m) => cell(pad(m), m === draft.m, () => setDraft((d) => ({ ...d, m }))))}
              </View>
              <Text style={[styles.preview, { color: t.colors.text }]}>
                {pad(draft.h)}:{pad(draft.m)}
              </Text>
            </View>,
            () => {
              commit(draft);
              setOpen(false);
            }
          )
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: fontSize.sm, fontWeight: '600' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  fieldText: { fontSize: fontSize.lg, fontWeight: '700', flex: 1, textAlign: 'center' },
  chip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    width: 66,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: fontSize.sm, fontWeight: '600' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  modalBar: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm },
  modalGrabber: { width: 40, height: 4, borderRadius: 2 },
  modalTitle: { fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center', marginBottom: spacing.sm },
  modalBtn: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontWeight: '700', fontSize: fontSize.lg },
  gridWrap: { gap: spacing.sm },
  gridLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: {
    width: '15%',
    flexGrow: 1,
    minHeight: 40,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontSize: fontSize.md, fontWeight: '600' },
  preview: { fontSize: fontSize.lg, fontWeight: '700', textAlign: 'center', marginTop: spacing.xs },
});