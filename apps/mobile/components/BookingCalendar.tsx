import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import {
  addMonths,
  calendarNames,
  canGoNextMonth,
  canGoPrevMonth,
  isDayDisabled,
  monthGrid,
  monthOfYmd,
  type CalendarRules,
  type DayTone,
} from '@/lib/bookingCalendar';
import { useLanguage } from '@/lib/i18n';
import type { TrKey } from '@/lib/i18n';
import { useMonthHeat, type HeatSource } from '@/lib/useMonthHeat';

type Props = CalendarRules & {
  /** Ziua aleasă, "YYYY-MM-DD". */
  value: string;
  onChange: (ymd: string) => void;
  /** Culorile zilelor (cât de plină e ziua). Lipsă = calendar simplu. */
  heat?: HeatSource | null;
  /**
   * Business: toate zilele se pot alege (și cele trecute sau închise), fără limită la săgeți.
   * `minYmd` rămâne doar ziua de azi (cercul).
   */
  browse?: boolean;
};

type ToneColors = { bg: string; fg: string };

function useToneColors(): Record<Exclude<DayTone, 'closed'>, ToneColors> {
  const t = useTheme();
  // Secvență teal → sky → amber → orange: se deosebește și fără roșu/verde, cu legendă dedesubt.
  return {
    free: { bg: t.colors.accentSoft, fg: t.colors.accentSoftText },
    moderate: { bg: t.colors.infoSoft, fg: t.colors.infoSoftText },
    almostFull: { bg: t.colors.warningSoft, fg: t.colors.warningSoftText },
    full: { bg: t.colors.warmSoft, fg: t.colors.warmSoftText },
  };
}

const LEGEND_BUSINESS: { tone: DayTone; key: TrKey }[] = [
  { tone: 'free', key: 'calendar.toneFree' },
  { tone: 'moderate', key: 'calendar.toneModerate' },
  { tone: 'almostFull', key: 'calendar.toneAlmostFull' },
  { tone: 'full', key: 'calendar.toneFull' },
  { tone: 'closed', key: 'calendar.toneClosed' },
];
const LEGEND_CLIENT: { tone: DayTone; key: TrKey }[] = [
  { tone: 'free', key: 'calendar.toneAvailable' },
  { tone: 'almostFull', key: 'calendar.toneFewLeft' },
  { tone: 'full', key: 'calendar.toneFull' },
];

/** Calendar lunar: luni primul, zilele nerezervabile gri, opțional colorate după cât de pline sunt. */
export function BookingCalendar({ value, onChange, minYmd, maxYmd, blockedDates, schedules, heat, browse }: Props) {
  const t = useTheme();
  const { lang, t: tr } = useLanguage();
  const names = calendarNames(lang);
  const toneColors = useToneColors();
  const [view, setView] = useState(() => monthOfYmd(value || minYmd));
  const { tones, counts } = useMonthHeat(heat, view);
  const showCounts = heat?.kind === 'business';
  const legend = heat ? (heat.kind === 'business' ? LEGEND_BUSINESS : LEGEND_CLIENT) : null;

  // Când data aleasă se schimbă din afară (ex. prima zi liberă), arătăm luna ei.
  useEffect(() => {
    if (value) setView(monthOfYmd(value));
  }, [value]);

  const rows = useMemo(() => monthGrid(view), [view]);
  const rules: CalendarRules = { minYmd, maxYmd, blockedDates, schedules };
  const prevOn = browse || canGoPrevMonth(view, minYmd);
  const nextOn = browse || canGoNextMonth(view, maxYmd);

  return (
    <View
      style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
      testID="booking-calendar"
    >
      <View style={styles.header}>
        <Pressable
          android_ripple={{ color: t.colors.accentSoft, borderless: true }}
          accessibilityRole="button"
          accessibilityLabel={tr('calendar.prevMonth')}
          accessibilityState={{ disabled: !prevOn }}
          disabled={!prevOn}
          onPress={() => setView((v) => addMonths(v, -1))}
          style={[styles.arrow, { opacity: prevOn ? 1 : 0.3 }]}
          testID="calendar-prev"
        >
          <Ionicons name="chevron-back" size={20} color={t.colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: t.colors.text }]}>
          {names.months[view.month]} {view.year}
        </Text>
        <Pressable
          android_ripple={{ color: t.colors.accentSoft, borderless: true }}
          accessibilityRole="button"
          accessibilityLabel={tr('calendar.nextMonth')}
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
        {names.weekdays.map((d) => (
          <View key={d} style={styles.cell}>
            <Text style={[styles.weekday, { color: t.colors.textMuted }]}>{d}</Text>
          </View>
        ))}
      </View>

      {rows.map((week, i) => (
        <View key={i} style={styles.row}>
          {week.map((ymd, j) => {
            if (!ymd) return <View key={`e${j}`} style={styles.cell} />;
            const disabled = browse ? false : isDayDisabled(ymd, rules);
            const selected = ymd === value;
            const today = ymd === minYmd;
            const tone = disabled ? undefined : tones[ymd];
            const tint = tone && tone !== 'closed' ? toneColors[tone] : null;
            const count = showCounts ? counts[ymd] ?? 0 : 0;
            const toneLabel = tone ? tr(toneLabelKey(tone, heat?.kind === 'business')) : '';
            return (
              <View key={ymd} style={styles.cell}>
                <Pressable
                  android_ripple={{ color: t.colors.accentSoft, borderless: false }}
                  accessibilityRole="button"
                  accessibilityLabel={[
                    `${Number(ymd.slice(8))} ${names.months[Number(ymd.slice(5, 7)) - 1]} ${ymd.slice(0, 4)}`,
                    toneLabel,
                    count > 0 ? tr('calendar.countA11y', { n: count }) : '',
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  hitSlop={4}
                  accessibilityState={{ disabled, selected }}
                  disabled={disabled}
                  onPress={() => onChange(ymd)}
                  testID={`calendar-day-${ymd}`}
                  style={[
                    styles.day,
                    tint ? { backgroundColor: tint.bg } : null,
                    selected ? { backgroundColor: t.colors.accent } : null,
                    today && !selected ? { borderWidth: 1, borderColor: t.colors.accent } : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      {
                        color: selected
                          ? t.colors.onAccent
                          : disabled || tone === 'closed'
                            ? t.colors.textMuted
                            : tint
                              ? tint.fg
                              : t.colors.text,
                        opacity: disabled && !selected ? 0.4 : 1,
                        fontWeight: selected ? '800' : '600',
                      },
                    ]}
                  >
                    {Number(ymd.slice(8))}
                  </Text>
                </Pressable>
                {count === 1 ? (
                  <View pointerEvents="none" style={[styles.dot, { backgroundColor: selected ? t.colors.onAccent : t.colors.text, borderColor: t.colors.surface }]} />
                ) : count > 1 ? (
                  <View pointerEvents="none" style={[styles.countBadge, { backgroundColor: t.colors.text, borderColor: t.colors.surface }]}>
                    <Text style={[styles.countText, { color: t.colors.surface }]} numberOfLines={1}>
                      {count > 99 ? '99+' : count}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ))}

      {legend ? (
        <View style={styles.legend} accessibilityRole="text">
          {legend.map(({ tone, key }) => (
            <View key={tone} style={styles.legendItem}>
              <View
                style={[
                  styles.legendSwatch,
                  tone === 'closed'
                    ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: t.colors.border }
                    : { backgroundColor: toneColors[tone].bg },
                ]}
              />
              <Text style={[styles.legendText, { color: t.colors.textMuted }]}>{tr(key)}</Text>
            </View>
          ))}
          {showCounts ? (
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: t.colors.text }]} />
              <Text style={[styles.legendText, { color: t.colors.textMuted }]}>{tr('calendar.legendCount')}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function toneLabelKey(tone: DayTone, business: boolean): TrKey {
  if (tone === 'free') return business ? 'calendar.toneFree' : 'calendar.toneAvailable';
  if (tone === 'moderate') return 'calendar.toneModerate';
  if (tone === 'almostFull') return business ? 'calendar.toneAlmostFull' : 'calendar.toneFewLeft';
  if (tone === 'full') return 'calendar.toneFull';
  return 'calendar.toneClosed';
}

const styles = StyleSheet.create({
  // Padding orizontal mai mic: 7 zile × 48 px încap și pe un telefon de 390 px (retest 3.24).
  card: { borderWidth: 1, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, gap: spacing.xs },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  arrow: { width: spacing.touchTarget, height: spacing.touchTarget, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.md, fontWeight: '800' },
  // Antetul și grila folosesc aceeași celulă: 7 coloane egale.
  row: { flexDirection: 'row' },
  cell: { flex: 1, flexBasis: 0, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  weekday: { fontSize: fontSize.sm, fontWeight: '700' },
  // Țintă de 48 px (cât permite coloana pe ecrane foarte înguste).
  day: {
    width: '100%',
    maxWidth: spacing.touchTarget,
    height: spacing.touchTarget,
    borderRadius: spacing.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  dayText: { fontSize: fontSize.md },
  dot: { position: 'absolute', top: 2, right: '22%', width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
  countBadge: {
    position: 'absolute',
    top: 0,
    right: '14%',
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontSize: 10, fontWeight: '800', lineHeight: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4, marginTop: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 7 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: fontSize.xs, fontWeight: '600' },
});
