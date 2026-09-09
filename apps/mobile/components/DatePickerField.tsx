import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';

type Props = {
  /** YYYY-MM-DD */
  value: string;
  onChange: (ymd: string) => void;
  label?: string;
  minimumDate?: Date;
  maximumDate?: Date;
};

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatRo(ymd: string): string {
  const d = parseYmd(ymd);
  try {
    return d.toLocaleDateString('ro-RO', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return ymd;
  }
}

/**
 * Câmp dată: la apăsare deschide calendarul nativ.
 * Nu permite tastare liberă. Shell vizual aliniat cu Field (label, border, focus).
 */
export function DatePickerField({
  value,
  onChange,
  label = 'Data',
  minimumDate,
  maximumDate,
}: Props) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const dateValue = useMemo(() => parseYmd(value), [value]);

  function apply(next: Date) {
    onChange(toYmd(next));
  }

  function onNativeChange(event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') {
      setOpen(false);
      if (event.type === 'dismissed') return;
    }
    if (selected) apply(selected);
  }

  const field = (children: React.ReactNode, onPress?: () => void) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.field,
        {
          backgroundColor: t.colors.surface,
          borderColor:
            open || (pressed && onPress) ? t.colors.accent : t.colors.borderStrong,
          opacity: pressed ? 0.85 : 1,
        },
        open || (pressed && onPress) ? t.shadows.sm : null,
      ]}
    >
      {children}
    </Pressable>
  );

  // Web: input type=date (calendar browser)
  if (Platform.OS === 'web') {
    return (
      <View style={styles.wrap}>
        {label ? <Text style={[styles.label, { color: t.colors.textMuted }]}>{label}</Text> : null}
        {field(
          <>
            <Ionicons name="calendar-outline" size={17} color={t.colors.accent} />
            <input
              type="date"
              value={value}
              min={minimumDate ? toYmd(minimumDate) : undefined}
              max={maximumDate ? toYmd(maximumDate) : undefined}
              onChange={(e: { target: { value: string } }) => {
                if (e.target.value) onChange(e.target.value);
              }}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: 16,
                fontWeight: '600',
                background: 'transparent',
                fontFamily: 'inherit',
                color: t.colors.text,
              }}
            />
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {label ? <Text style={[styles.label, { color: t.colors.textMuted }]}>{label}</Text> : null}
      {field(
        <>
          <Ionicons
            name="calendar-outline"
            size={17}
            color={open ? t.colors.accent : t.colors.accent}
          />
          <Text style={[styles.fieldText, { color: t.colors.text }]} numberOfLines={1}>
            {formatRo(value)}
          </Text>
          <Ionicons name="chevron-down" size={17} color={t.colors.textFaint} />
        </>,
        () => setOpen(true)
      )}

      {/* Android: dialog nativ odată deschis */}
      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={dateValue}
          mode="date"
          display="calendar"
          onChange={onNativeChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      ) : null}

      {/* iOS: modal cu spinner + Confirmă */}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide">
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: t.colors.overlay }]}
            onPress={() => setOpen(false)}
          >
            <View
              style={[
                styles.modalCard,
                { backgroundColor: t.colors.bgElevated },
                t.shadows.lg,
              ]}
            >
              <View style={styles.modalBar}>
                <View style={[styles.modalGrabber, { backgroundColor: t.colors.borderStrong }]} />
              </View>
              <Text style={[styles.modalTitle, { color: t.colors.text }]}>Alege data</Text>
              <DateTimePicker
                value={dateValue}
                mode="date"
                display="inline"
                onChange={(_e, selected) => {
                  if (selected) apply(selected);
                }}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                style={{ alignSelf: 'center' }}
              />
              <Pressable
                style={({ pressed }) => [
                  styles.modalBtn,
                  {
                    backgroundColor: t.colors.accent,
                    opacity: pressed ? 0.85 : 1,
                    minHeight: spacing.touchTarget,
                  },
                ]}
                onPress={() => setOpen(false)}
              >
                <Text style={[styles.modalBtnText, { color: t.colors.onAccent }]}>Gata</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      ) : null}
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
    paddingVertical: 13,
    minHeight: spacing.touchTarget,
  },
  fieldText: {
    fontSize: fontSize.lg,
    fontWeight: '600',
    flex: 1,
    textTransform: 'capitalize',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalCard: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['3xl'],
  },
  modalBar: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.sm },
  modalGrabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  modalBtn: {
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnText: { fontWeight: '700', fontSize: fontSize.lg },
});
