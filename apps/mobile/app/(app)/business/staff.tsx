import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { WorkingHoursForm } from '@/components/WorkingHoursForm';
import {
  Button,
  Callout,
  EmptyState,
  Field,
  ListLoadingScreen,
  Screen,
  SectionTitle,
  Toggle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { DEFAULT_BREAK_HOURS, DEFAULT_WORKING_HOURS, STAFF_COLORS } from '@/lib/defaults';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { BreakHours, Staff, WorkingHours } from '@/lib/types';

type Draft = {
  name: string;
  customHours: boolean;
  workingHours: WorkingHours;
  breakHours: BreakHours;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  customHours: false,
  workingHours: DEFAULT_WORKING_HOURS,
  breakHours: DEFAULT_BREAK_HOURS,
};

export default function BusinessStaffScreen() {
  const t = useTheme();
  const back = useBack();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rows, setRows] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

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
      .select('id')
      .eq('owner_user_id', user.id)
      .maybeSingle();
    if (bErr) {
      setError(bErr.message);
      setLoading(false);
      return;
    }
    if (!biz) {
      setBusinessId(null);
      setRows([]);
      setLoading(false);
      return;
    }
    setBusinessId(biz.id);
    const { data, error: sErr } = await supabase
      .from('staff')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (sErr) {
      setError(sErr.message);
    } else {
      setRows((data ?? []) as Staff[]);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  function startNew() {
    setMessage(null);
    setEditingId('new');
    setDraft(EMPTY_DRAFT);
  }

  function startEdit(s: Staff) {
    setMessage(null);
    setEditingId(s.id);
    setDraft({
      name: s.name,
      customHours: Boolean(s.working_hours),
      workingHours: s.working_hours ?? DEFAULT_WORKING_HOURS,
      breakHours: s.break_hours ?? DEFAULT_BREAK_HOURS,
    });
  }

  async function saveDraft() {
    if (!businessId) return;
    const name = draft.name.trim();
    if (!name) {
      setError('Introdu numele specialistului.');
      return;
    }
    const hours = draft.customHours
      ? { working_hours: draft.workingHours, break_hours: draft.breakHours }
      : { working_hours: null, break_hours: null };
    setSaving(true);
    setError(null);
    setMessage(null);
    if (editingId === 'new') {
      const { error: err } = await supabase.from('staff').insert({
        business_id: businessId,
        name,
        color: STAFF_COLORS[rows.length % STAFF_COLORS.length],
        sort_order: rows.length,
        active: true,
        ...hours,
      });
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      setEditingId(null);
      setMessage('Specialist adăugat.');
      await load();
      return;
    }
    const { error: err } = await supabase
      .from('staff')
      .update({
        name,
        ...hours,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    setMessage('Specialist actualizat.');
    await load();
  }

  async function toggleActive(s: Staff) {
    setError(null);
    const { error: err } = await supabase
      .from('staff')
      .update({ active: !s.active, updated_at: new Date().toISOString() })
      .eq('id', s.id);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
  }

  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title="Echipă"
        subtitle="Cine lucrează și când"
        onBack={back}
        label="Se încarcă echipa…"
      />
    );
  }

  if (!businessId) {
    return (
      <Screen title="Echipă" onBack={back}>
        <EmptyState
          icon="people-outline"
          title="Configurează mai întâi business-ul"
          description="Apoi poți adăuga specialiști, fiecare cu program propriu."
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Echipă"
      subtitle="Cine lucrează și când"
      onBack={back}
      footer={
        editingId ? (
          <View style={styles.footer}>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <Button
              label={saving ? 'Se salvează…' : editingId === 'new' ? 'Adaugă' : 'Salvează'}
              icon="checkmark"
              loading={saving}
              onPress={() => void saveDraft()}
            />
            <Button
              label="Renunță"
              variant="secondary"
              onPress={() => {
                setEditingId(null);
                setError(null);
              }}
            />
          </View>
        ) : (
          <View style={styles.footer}>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            {message ? <Callout tone="success">{message}</Callout> : null}
            <Button label="Adaugă specialist" icon="add" onPress={startNew} />
          </View>
        )
      }
    >
      {editingId ? (
        <>
          <SectionTitle>{editingId === 'new' ? 'Specialist nou' : 'Editează'}</SectionTitle>
          <Field
            label="Nume"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder="Ana, Mihai…"
            icon="person-outline"
            autoCapitalize="words"
          />
          <View
            style={[
              styles.toggleRow,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.toggleTitle, { color: t.colors.text }]}>Program propriu</Text>
              <Text style={[styles.toggleSub, { color: t.colors.textMuted }]}>
                Dacă e oprit, folosește programul business-ului.
              </Text>
            </View>
            <Toggle
              value={draft.customHours}
              onValueChange={(customHours) => setDraft((d) => ({ ...d, customHours }))}
              accessibilityLabel="Program propriu"
            />
          </View>
          {draft.customHours ? (
            <WorkingHoursForm
              value={draft.workingHours}
              onChange={(workingHours) => setDraft((d) => ({ ...d, workingHours }))}
            />
          ) : null}
        </>
      ) : null}

      {rows.length === 0 && !editingId ? (
        <EmptyState
          icon="people-outline"
          title="Niciun specialist"
          description="Adaugă echipa ca clienții să aleagă la cine se programează."
        />
      ) : (
        rows.map((s) => (
          <View
            key={s.id}
            style={[
              styles.row,
              {
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
                opacity: s.active ? 1 : 0.55,
              },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: s.color }]} />
            <Pressable onPress={() => startEdit(s)} style={styles.rowText}>
              <Text style={[styles.rowName, { color: t.colors.text }]}>{s.name}</Text>
              <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
                {s.working_hours ? 'Program propriu' : 'Programul business-ului'}
                {s.active ? '' : ' · inactiv'}
              </Text>
            </Pressable>
            <Toggle
              value={s.active}
              onValueChange={() => void toggleActive(s)}
              accessibilityLabel={s.active ? 'Dezactivează' : 'Activează'}
            />
            <Pressable onPress={() => startEdit(s)} hitSlop={8}>
              <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
            </Pressable>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  flex: { flex: 1, gap: 2 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  toggleTitle: { fontSize: fontSize.md, fontWeight: '600' },
  toggleSub: { fontSize: fontSize.sm, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: fontSize.md, fontWeight: '700' },
  rowMeta: { fontSize: fontSize.sm },
});
