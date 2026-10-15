import { StyleSheet, Text, View } from 'react-native';

import { Field, SectionTitle, Toggle, useTheme } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { fontSize, spacing } from '@/constants/theme';
import type { BreakHours } from '@/lib/types';

type Props = {
  value: BreakHours;
  onChange: (next: BreakHours) => void;
};

/** Pauza zilnica editabila (activata + interval), folosita la business si staff. */
export function BreakHoursForm({ value, onChange }: Props) {
  const t = useTheme();
  const tr = useT();

  return (
    <View style={styles.wrap}>
      <SectionTitle>{tr('team.breakTitle')}</SectionTitle>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={[styles.title, { color: t.colors.text }]}>{tr('team.breakEnabled')}</Text>
          <Text style={[styles.sub, { color: t.colors.textMuted }]}>{tr('team.breakHint')}</Text>
        </View>
        <Toggle
          value={value.enabled}
          onValueChange={(enabled) => onChange({ ...value, enabled })}
          accessibilityLabel={tr('team.breakEnabled')}
        />
      </View>
      {value.enabled ? (
        <View style={styles.times}>
          <View style={styles.timeField}>
            <Field
              label={tr('team.breakStart')}
              value={value.start}
              onChangeText={(start) => onChange({ ...value, start })}
              placeholder="13:00"
            />
          </View>
          <View style={styles.timeField}>
            <Field
              label={tr('team.breakEnd')}
              value={value.end}
              onChangeText={(end) => onChange({ ...value, end })}
              placeholder="14:00"
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.md, fontWeight: '700' },
  sub: { fontSize: fontSize.sm },
  times: { flexDirection: 'row', gap: spacing.md },
  timeField: { flex: 1 },
});
