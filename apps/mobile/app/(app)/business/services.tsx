import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

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
import { formatDuration, formatRon } from '@/lib/format';
import { useBack } from '@/lib/nav';
import { supabase } from '@/lib/supabase';
import type { Service } from '@/lib/types';

type Draft = {
  name: string;
  duration: string;
  price: string;
};

const EMPTY_DRAFT: Draft = { name: '', duration: '60', price: '0' };

export default function BusinessServicesScreen() {
  const t = useTheme();
  const back = useBack();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rows, setRows] = useState<Service[]>([]);
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
      .select('id, session_duration_minutes')
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
      .from('services')
      .select('*')
      .eq('business_id', biz.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (sErr) {
      setError(sErr.message);
    } else {
      setRows((data ?? []) as Service[]);
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

  function startEdit(s: Service) {
    setMessage(null);
    setEditingId(s.id);
    setDraft({
      name: s.name,
      duration: String(s.duration_minutes),
      price: String(s.price ?? 0),
    });
  }

  async function saveDraft() {
    if (!businessId) return;
    const name = draft.name.trim();
    const duration = parseInt(draft.duration, 10);
    const price = Number(String(draft.price).replace(',', '.'));
    if (!name) {
      setError('Introdu numele serviciului.');
      return;
    }
    if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
      setError('Durata trebuie să fie între 5 și 480 minute.');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('Prețul trebuie să fie 0 sau mai mare.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    if (editingId === 'new') {
      const { error: err } = await supabase.from('services').insert({
        business_id: businessId,
        name,
        duration_minutes: duration,
        price,
        sort_order: rows.length,
        active: true,
      });
      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      setEditingId(null);
      setMessage('Serviciu adăugat.');
      await load();
      return;
    }
    const { error: err } = await supabase
      .from('services')
      .update({
        name,
        duration_minutes: duration,
        price,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    setMessage('Serviciu actualizat.');
    await load();
  }

  async function toggleActive(s: Service) {
    setError(null);
    const { error: err } = await supabase
      .from('services')
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
        title="Servicii"
        subtitle="Cât durează și cât costă"
        onBack={back}
        label="Se încarcă serviciile…"
      />
    );
  }

  if (!businessId) {
    return (
      <Screen title="Servicii" onBack={back}>
        <EmptyState
          icon="cut-outline"
          title="Configurează mai întâi business-ul"
          description="Serviciile (tuns, vopsit, consultație) se adaugă după ce ai o agendă."
        />
      </Screen>
    );
  }

  return (
    <Screen
      title="Servicii"
      subtitle="Cât durează și cât costă"
      onBack={back}
      footer={
        editingId ? (
          <View style={styles.footer}>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <Button
              label={saving ? 'Se salvează…' : editingId === 'new' ? 'Adaugă serviciul' : 'Salvează'}
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
            <Button label="Adaugă serviciu" icon="add" onPress={startNew} />
          </View>
        )
      }
    >
      {editingId ? (
        <>
          <SectionTitle>{editingId === 'new' ? 'Serviciu nou' : 'Editează serviciul'}</SectionTitle>
          <Field
            label="Nume"
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder="Tuns, vopsit, consultație…"
            icon="cut-outline"
            autoCapitalize="sentences"
          />
          <Field
            label="Durată (minute)"
            value={draft.duration}
            onChangeText={(duration) => setDraft((d) => ({ ...d, duration }))}
            placeholder="60"
            keyboardType="number-pad"
            icon="time-outline"
          />
          <Field
            label="Preț (lei)"
            value={draft.price}
            onChangeText={(price) => setDraft((d) => ({ ...d, price }))}
            placeholder="0"
            keyboardType="decimal-pad"
            icon="cash-outline"
            hint="0 = preț la fața locului, comunicat clientului de tine."
          />
        </>
      ) : null}

      {rows.length === 0 && !editingId ? (
        <EmptyState
          icon="cut-outline"
          title="Niciun serviciu"
          description="Adaugă cel puțin un serviciu ca clienții să aleagă durata corectă."
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
            <Pressable onPress={() => startEdit(s)} style={styles.rowText}>
              <Text style={[styles.rowName, { color: t.colors.text }]}>{s.name}</Text>
              <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
                {formatDuration(s.duration_minutes)} · {formatRon(s.price)}
                {s.active ? '' : ' · inactiv'}
              </Text>
            </Pressable>
            <View style={styles.rowRight}>
              <Toggle
                value={s.active}
                onValueChange={() => void toggleActive(s)}
                accessibilityLabel={s.active ? 'Dezactivează' : 'Activează'}
              />
              <Pressable onPress={() => startEdit(s)} hitSlop={8}>
                <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
              </Pressable>
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: fontSize.md, fontWeight: '700' },
  rowMeta: { fontSize: fontSize.sm },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
