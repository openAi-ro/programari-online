import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  addMonths,
  CALENDAR_MONTHS_RO,
  CALENDAR_WEEKDAYS_RO,
  canGoNextMonth,
  canGoPrevMonth,
  isDayDisabled,
  monthGrid,
  monthOfYmd,
  type CalendarRules,
} from '@/lib/bookingCalendar';

const SELECTED_BG = '#2dd4bf';
const SELECTED_TEXT = '#0b1220';

type Props = CalendarRules & {
  /** Ziua aleasă, "YYYY-MM-DD". */
  value: string;
  onChange: (ymd: string) => void;
};

/** Calendar lunar pentru rezervare: luni primul, zilele nerezervabile gri. */
export function BookingCalendar({ value, onChange, minYmd, maxYmd, blockedDates, schedules }: Props) {
  const t = useTheme();
  const [view, setView] = useState(() => monthOfYmd(value || minYmd));

  // Când data aleasă se schimbă din afară (ex. prima zi liberă), arătăm luna ei.
  useEffect(() => {
    if (value) setView(monthOfYmd(value));
  }, [value]);

  const rows = useMemo(() => monthGrid(view), [view]);
  const rules: CalendarRules = { minYmd, maxYmd, blockedDates, schedules };
  const prevOn = canGoPrevMonth(view, minYmd);
  const nextOn = canGoNextMonth(view, maxYmd);

  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
      testID="booking-calendar"
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Luna anterioară"
          accessibilityState={{ disabled: !prevOn }}
          disabled={!prevOn}
          onPress={() => setView((v) => addMonths(v, -1))}
          style={[styles.arrow, { opacity: prevOn ? 1 : 0.3 }]}
          testID="calendar-prev"
        >
          <Ionicons name="chevron-back" size={20} color={t.colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: t.colors.text }]}>
          {CALENDAR_MONTHS_RO[view.month]} {view.year}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Luna următoare"
          accessibilityState={{ disabled: !nextOn }}
          disabled={!nextOn}
          onPress={() => setView((v) => addMonths(v, 1))}
          style={[styles.arrow, { opacity: nextOn ? 1 : 0.3 }]}
          testID="calendar-next"
        >
          <Ionicons name="chevron-forward" size={20} color={t.colors.text} />
        </Pressable>
      </View>

      <View style={styles.row}>
        {CALENDAR_WEEKDAYS_RO.map((d) => (
          <View key={d} style={styles.cell}>
            <Text style={[styles.weekday, { color: t.colors.textMuted }]}>{d}</Text>
          </View>
        ))}
      </View>

      {rows.map((week, i) => (
        <View key={i} style={styles.row}>
          {week.map((ymd, j) => {
            if (!ymd) return <View key={`e${j}`} style={styles.cell} />;
            const disabled = isDayDisabled(ymd, rules);
            const selected = ymd === value;
            const today = ymd === minYmd;
            return (
              <View key={ymd} style={styles.cell}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={ymd}
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  onPress={() => onChange(ymd)}
                  testID={`calendar-day-${ymd}`}
                  style={[
                    styles.day,
                    selected ? { backgroundColor: SELECTED_BG } : null,
                    today && !selected ? { borderWidth: 1, borderColor: SELECTED_BG } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      {
                        color: selected
                          ? SELECTED_TEXT
                          : disabled
                            ? t.colors.textMuted
                            : t.colors.text,
                        opacity: disabled && !selected ? 0.4 : 1,
                        fontWeight: selected ? '800' : '600',
                      },
                    ]}
                  >
                    {Number(ymd.slice(8))}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.md, fontWeight: '800' },
  // Antetul și grila folosesc aceeași celulă: 7 coloane egale.
  row: { flexDirection: 'row' },
  cell: { flex: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  weekday: { fontSize: fontSize.sm, fontWeight: '700' },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: fontSize.md },
});