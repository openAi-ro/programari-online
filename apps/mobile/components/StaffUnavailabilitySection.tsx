import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DatePickerField } from '@/components/DatePickerField';
import { Button, Callout, Field, SectionTitle, useTheme } from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { getCurrentUser } from '@/lib/currentUser';
import { useT } from '@/lib/i18n';
import {
  createStaffUnavailability,
  deleteStaffUnavailability,
  fetchStaffUnavailability,
  type StaffUnavailability,
} from '@/lib/staffUnavailability';

/** Concedii și zile libere pentru un specialist (v90), afișate în calendar și blocate la rezervare. */
export function StaffUnavailabilitySection({
  businessId,
  staffId,
}: {
  businessId: string;
  staffId: string;
}) {
  const t = useTheme();
  const tr = useT();
  const [rows, setRows] = useState<StaffUnavailability[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const year = new Date().getFullYear();
    const { rows: data } = await fetchStaffUnavailability({
      businessId,
      staffId,
      fromYmd: `${year - 1}-01-01`,
      toYmd: `${year + 2}-12-31`,
    });
    setRows(data);
  }, [businessId, staffId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const user = await getCurrentUser();
    const { error: err } = await createStaffUnavailability({
      businessId,
      staffId,
      startDate: from,
      endDate: to || from,
      reason: reason.trim() ? reason.trim() : null,
      createdBy: user?.id ?? null,
    });
    setBusy(false);
    if (err) {
      setError(err === 'unavailability_range_invalid' ? tr('unavail.invalid') : err);
      return;
    }
    setReason('');
    setMessage(tr('unavail.added'));
    await load();
  }

  return (
    <View style={styles.box}>
      <SectionTitle>{tr('unavail.title')}</SectionTitle>
      <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }}>{tr('unavail.hint')}</Text>
      {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
      {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}
      {rows.map((r) => (
        <View
          key={r.id}
          style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
        >
          <View style={styles.flex}>
            <Text style={{ color: t.colors.text, fontWeight: '700' }}>
              {r.start_date} → {r.end_date}
            </Text>
            {r.reason ? (
              <Text style={{ color: t.colors.textMuted, fontSize: fontSize.sm }}>{r.reason}</Text>
            ) : null}
          </View>
          <Button
            label={tr('unavail.delete')}
            size="sm"
            variant="secondary"
            onPress={() => void deleteStaffUnavailability(r.id).then(() => load())}
          />
        </View>
      ))}
      <DatePickerField label={tr('unavail.from')} value={from} onChange={setFrom} />
      <DatePickerField label={tr('unavail.to')} value={to} onChange={setTo} />
      <Field label={tr('unavail.reason')} value={reason} onChangeText={setReason} />
      <Button label={tr('unavail.add')} icon="calendar-outline" loading={busy} onPress={() => void add()} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  flex: { flex: 1, gap: 2 },
});
