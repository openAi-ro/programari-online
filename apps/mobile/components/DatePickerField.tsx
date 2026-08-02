import { useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

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
 * Nu permite tastare liberă.
 */
export function DatePickerField({
  value,
  onChange,
  label = 'Data',
  minimumDate,
  maximumDate,
}: Props) {
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

  // Web: input type=date (calendar browser)
  if (Platform.OS === 'web') {
    return (
      <View>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        <View style={styles.field}>
          {/* @ts-expect-error web-only input */}
          <input
            type="date"
            value={value}
            min={minimumDate ? toYmd(minimumDate) : undefined}
            max={maximumDate ? toYmd(maximumDate) : undefined}
            onChange={(e: { target: { value: string } }) => {
              if (e.target.value) onChange(e.target.value);
            }}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              fontSize: 16,
              background: 'transparent',
              fontFamily: 'inherit',
            }}
          />
        </View>
        <Text style={styles.hint}>{formatRo(value)}</Text>
      </View>
    );
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Pressable style={styles.field} onPress={() => setOpen(true)}>
        <Text style={styles.fieldText}>{formatRo(value)}</Text>
        <Text style={styles.chevron}>📅</Text>
      </Pressable>
      <Text style={styles.hint}>Apasă pentru a deschide calendarul</Text>

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
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Alege data</Text>
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
              <Pressable style={styles.modalBtn} onPress={() => setOpen(false)}>
                <Text style={styles.modalBtnText}>Gata</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: '#475569', marginTop: 12, marginBottom: 6 },
  field: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    flex: 1,
    textTransform: 'capitalize',
  },
  chevron: { fontSize: 18, marginLeft: 8 },
  hint: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 32,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  modalBtn: {
    marginTop: 12,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
