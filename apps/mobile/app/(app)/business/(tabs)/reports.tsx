import { useCallback, useState, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  Callout,
  EmptyState,
  Screen,
  SectionTitle,
  SkeletonScreen,
  SkeletonStatGrid,
  useTheme,
} from '@/components/ui';
import { markNavReady, measureBeforeEnabled } from '@/lib/navTiming';
import { fontSize, radius, spacing } from '@/constants/theme';
import { formatLei } from '@/lib/format';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';

type Report = {
  days: number;
  approved: number;
  pending: number;
  cancelled: number;
  rejected: number;
  no_show: number;
  loyalty_redeemed: number;
  revenue_ron: number;
  deposits_ron: number;
  avg_rating: number | null;
  review_count: number;
  top_services: { name: string; count: number; revenue_ron: number }[];
  staff: { name: string; approved: number; no_show: number; revenue_ron: number }[];
};

export default function BusinessReportsScreen() {
  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.count('[TAB_MOUNT] business/reports');
    }
  }, []);
  const t = useTheme();
  const back = useBack();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('business_report', { p_days: 30 });
    if (err) {
      setError(err.message);
      setReport(null);
    } else {
      setReport((data ?? null) as Report | null);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      const hasExistingData = !!report;
      if (measureBeforeEnabled() || !hasExistingData) setLoading(true);
      void load().then(() => {
        markNavReady('reports', {
          hasExistingData,
          softRefresh: hasExistingData && !measureBeforeEnabled(),
        });
      });
    }, [load, report])
  );

  if (loading && !report) {
    return (
      <View style={{ flex: 1 }}>
        <SkeletonScreen title="Rapoarte" onBack={back} blocks={2}>
          <SkeletonStatGrid />
        </SkeletonScreen>
      </View>
    );
  }

  if (!report) {
    return (
      <Screen title="Rapoarte" onBack={back}>
        {error ? <Callout tone="danger">{error}</Callout> : null}
        <EmptyState
          icon="stats-chart-outline"
          title="Nu am putut încărca rapoartele"
          description="Configurează business-ul, apoi revino aici."
        />
      </Screen>
    );
  }

  const denom = Number(report.approved) + Number(report.no_show);
  const noShowPct =
    denom > 0 ? Math.round((Number(report.no_show) / denom) * 100) : 0;

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Rapoarte" subtitle={`Ultimele ${report.days} zile`} onBack={back}>
      {error ? <Callout tone="danger">{error}</Callout> : null}

      <View style={styles.grid}>
        <Stat label="Confirmate" value={String(report.approved)} color={t.colors.text} />
        <Stat label="Venit estimat" value={formatLei(report.revenue_ron)} color={t.colors.text} />
        <Stat label="No-show" value={`${report.no_show} (${noShowPct}%)`} color={t.colors.danger} />
        <Stat
          label="Recenzii"
          value={
            report.review_count
              ? `${report.avg_rating ?? '—'} ★ · ${report.review_count}`
              : '—'
          }
          color={t.colors.text}
        />
        <Stat label="Anulate" value={String(report.cancelled)} color={t.colors.textMuted} />
        <Stat label="Cadouri loialitate" value={String(report.loyalty_redeemed)} color={t.colors.text} />
      </View>

      <SectionTitle>Top servicii</SectionTitle>
      {(report.top_services ?? []).length === 0 ? (
        <EmptyState compact title="Nicio programare în interval" />
      ) : (
        (report.top_services ?? []).map((s) => (
          <View
            key={s.name}
            style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
          >
            <Text style={[styles.rowName, { color: t.colors.text }]}>{s.name}</Text>
            <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
              {s.count} · {formatLei(s.revenue_ron)}
            </Text>
          </View>
        ))
      )}

      <SectionTitle>Pe specialist</SectionTitle>
      {(report.staff ?? []).map((s) => (
        <View
          key={s.name}
          style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
        >
          <Text style={[styles.rowName, { color: t.colors.text }]}>{s.name}</Text>
          <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
            {s.approved} confirmate · {s.no_show} absențe · {formatLei(s.revenue_ron)}
          </Text>
        </View>
      ))}
    </Screen>
    </View>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  const t = useTheme();
  return (
    <View
      style={[styles.stat, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
    >
      <Text style={[styles.statLabel, { color: t.colors.textMuted }]}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    width: '48%',
    flexGrow: 1,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: 4,
  },
  statLabel: { fontSize: fontSize.xs, fontWeight: '700', textTransform: 'uppercase' },
  statValue: { fontSize: fontSize.lg, fontWeight: '800' },
  row: { padding: spacing.lg, borderRadius: radius.lg, borderWidth: 1, gap: 4 },
  rowName: { fontSize: fontSize.md, fontWeight: '700' },
  rowMeta: { fontSize: fontSize.sm },
});
