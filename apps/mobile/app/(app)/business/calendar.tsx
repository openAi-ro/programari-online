import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { DatePickerField } from '@/components/DatePickerField';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Screen,
  SkeletonScreen,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { STATUS_META } from '@/lib/status';
import { useBack } from '@/lib/nav';
import { formatInTimeZone, localDayBoundsUtc } from '@/lib/timezone';
import { supabase } from '@/lib/supabase';
import type { Appointment, BusinessProfile } from '@/lib/types';

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function BusinessCalendarScreen() {
  const t = useTheme();
  const back = useBack();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [rows, setRows] = useState<Appointment[]>([]);
  const [dateLocal, setDateLocal] = useState(toYmd(new Date()));
  const [staffFilter, setStaffFilter] = useState<string | 'all'>('all');
  const [staffList, setStaffList] = useState<{ id: string; name: string; color: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError('Nu ești autentificat.');
      return;
    }
    const { data: biz, error: bErr } = await supabase
      .from('business_profiles')
      .select('*')
      .eq('owner_user_id', user.id)
      .maybeSingle();
    if (bErr) {
      setError(bErr.message);
      setLoading(false);
      return;
    }
    if (!biz) {
      setBusiness(null);
      setRows([]);
      setLoading(false);
      return;
    }
    const profile = biz as BusinessProfile;
    setBusiness(profile);
    const { data: team } = await supabase
      .from('staff')
      .select('id, name, color')
      .eq('business_id', profile.id)
      .eq('active', true)
      .order('sort_order', { ascending: true });
    setStaffList((team ?? []) as { id: string; name: string; color: string }[]);
    const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, profile.timezone);
    let query = supabase
      .from('appointments')
      .select('*')
      .eq('business_id', profile.id)
      .in('status', ['pending', 'approved'])
      .lt('start_at', endUtc.toISOString())
      .gt('end_at', startUtc.toISOString())
      .order('start_at', { ascending: true });
    if (staffFilter !== 'all') query = query.eq('staff_id', staffFilter);
    const { data, error: aErr } = await query;
    if (aErr) {
      setError(aErr.message);
    } else {
      setRows((data ?? []) as Appointment[]);
    }
    setLoading(false);
  }, [dateLocal, staffFilter]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const blocked = useMemo(() => {
    const list = business?.blocked_dates ?? [];
    return list.includes(dateLocal);
  }, [business, dateLocal]);

  async function toggleBlockDay() {
    if (!business) return;
    setSaving(true);
    setError(null);
    const current = [...(business.blocked_dates ?? [])];
    const next = blocked
      ? current.filter((d) => d !== dateLocal)
      : [...current, dateLocal];
    const { error: err } = await supabase
      .from('business_profiles')
      .update({ blocked_dates: next, updated_at: new Date().toISOString() })
      .eq('id', business.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setBusiness({ ...business, blocked_dates: next });
  }

  if (loading && !business) {
    return <SkeletonScreen title="Calendar" onBack={back} blocks={5} label="Se încarcă agenda…" />;
  }

  if (!business) {
    return (
      <Screen title="Calendar" onBack={back}>
        <EmptyState
          icon="calendar-outline"
          title="Configurează mai întâi business-ul"
          description="Calendarul pe zile apare după ce salvezi agenda."
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Calendar"
      subtitle={business.name}
      onBack={back}
      footer={
        <View style={styles.footer}>
          {error ? <Callout tone="danger">{error}</Callout> : null}
          <Button
            label={blocked ? 'Deblochează ziua' : 'Blochează ziua (concediu)'}
            icon={blocked ? 'lock-open-outline' : 'lock-closed-outline'}
            variant={blocked ? 'secondary' : 'danger'}
            loading={saving}
            onPress={() => void toggleBlockDay()}
          />
          <Button
            label="Vezi cererile"
            variant="secondary"
            icon="hourglass-outline"
            onPress={() => router.push('/(app)/business/requests')}
          />
        </View>
      }
    >
      <DatePickerField label="Ziua" value={dateLocal} onChange={setDateLocal} />

      {staffList.length > 1 ? (
        <View style={styles.filters}>
          <Pressable
            onPress={() => setStaffFilter('all')}
            style={[
              styles.chip,
              {
                backgroundColor: staffFilter === 'all' ? t.colors.accent : t.colors.surface,
                borderColor: t.colors.border,
              },
            ]}
          >
            <Text
              style={{
                color: staffFilter === 'all' ? t.colors.onAccent : t.colors.text,
                fontWeight: '700',
                fontSize: fontSize.sm,
              }}
            >
              Toți
            </Text>
          </Pressable>
          {staffList.map((s) => {
            const on = staffFilter === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setStaffFilter(s.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: on ? t.colors.accent : t.colors.surface,
                    borderColor: t.colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: on ? t.colors.onAccent : t.colors.text,
                    fontWeight: '700',
                    fontSize: fontSize.sm,
                  }}
                >
                  {s.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {blocked ? (
        <Callout tone="warning" title="Zi blocată">
          Clienții nu pot alege sloturi în această zi. Programările existente rămân vizibile.
        </Callout>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon="sunny-outline"
          title={blocked ? 'Zi închisă, fără programări' : 'Nicio programare în această zi'}
          description={
            blocked
              ? 'Poți debloca ziua dacă vrei să primești din nou cereri.'
              : 'Când apar cereri pending sau confirmate, le vezi aici pe ore.'
          }
          compact
        />
      ) : (
        rows.map((a) => {
          const meta = STATUS_META[a.status];
          const start = formatInTimeZone(new Date(a.start_at), business.timezone, 'HH:mm');
          const end = formatInTimeZone(new Date(a.end_at), business.timezone, 'HH:mm');
          const contact = [a.client_email, a.client_phone].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={a.id}
              onPress={() => router.push('/(app)/business/requests')}
              style={({ pressed }) => [
                styles.item,
                {
                  backgroundColor: t.colors.surface,
                  borderColor: t.colors.border,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <View style={[styles.timeCol, { borderRightColor: t.colors.border }]}>
                <Text style={[styles.timeStart, { color: t.colors.text }]}>{start}</Text>
                <Text style={[styles.timeEnd, { color: t.colors.textFaint }]}>{end}</Text>
              </View>
              <View style={styles.itemBody}>
                <View style={styles.itemHead}>
                  <Text style={[styles.itemTitle, { color: t.colors.text }]} numberOfLines={1}>
                    {a.service_name ?? 'Ședință'}
                    {a.staff_name ? ` · ${a.staff_name}` : ''}
                  </Text>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </View>
                {a.no_show ? (
                  <Text style={[styles.contact, { color: t.colors.danger }]}>Nu s-a prezentat</Text>
                ) : a.payment_status === 'unpaid' ? (
                  <Text style={[styles.contact, { color: t.colors.warning }]}>Avans neplătit</Text>
                ) : null}
                {contact ? (
                  <View style={styles.contactRow}>
                    <Ionicons name="person-outline" size={13} color={t.colors.textFaint} />
                    <Text style={[styles.contact, { color: t.colors.textMuted }]} numberOfLines={1}>
                      {contact}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  item: {
    flexDirection: 'row',
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  timeCol: {
    width: 72,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  timeStart: { fontSize: fontSize.md, fontWeight: '800' },
  timeEnd: { fontSize: fontSize.xs, fontWeight: '600' },
  itemBody: { flex: 1, padding: spacing.md, gap: 6 },
  itemHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '700' },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contact: { fontSize: fontSize.sm, flexShrink: 1 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
