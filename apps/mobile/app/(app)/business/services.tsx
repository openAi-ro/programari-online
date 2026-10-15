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
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { supabase } from '@/lib/supabase';
import type { Service } from '@/lib/types';

type Draft = {
  name: string;
  description: string;
  duration: string;
  price: string;
};

const EMPTY_DRAFT: Draft = { name: '', description: '', duration: '60', price: '0' };

export default function BusinessServicesScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rows, setRows] = useState<Service[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      setError(trKey('req.notAuthed'));
      return;
    }
    const { data: biz, error: bErr } = await fetchMyBusinessResult(user.id);
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
      description: s.description ?? '',
      duration: String(s.duration_minutes),
      price: String(s.price ?? 0),
    });
  }

  async function saveDraft() {
    if (!businessId) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    const duration = parseInt(draft.duration, 10);
    const price = Number(String(draft.price).replace(',', '.'));
    if (!name) {
      setError(trKey('svc.nameRequired'));
      return;
    }
    if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
      setError(trKey('svc.badDuration'));
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError(trKey('svc.badPrice'));
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    if (editingId === 'new') {
      const { error: err } = await supabase.from('services').insert({
        business_id: businessId,
        name,
        description: description || null,
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
      setMessage(trKey('svc.added'));
      await load();
      return;
    }
    const { error: err } = await supabase
      .from('services')
      .update({
        name,
        description: description || null,
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
    setMessage(trKey('svc.updated'));
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

  async function moveService(s: Service, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === s.id);
    const other = rows[idx + dir];
    if (!other) return;
    setError(null);
    const a = await supabase.from('services').update({ sort_order: other.sort_order, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (a.error) { setError(a.error.message); return; }
    const b = await supabase.from('services').update({ sort_order: s.sort_order, updated_at: new Date().toISOString() }).eq('id', other.id);
    if (b.error) { setError(b.error.message); return; }
    await load();
  }

  async function deleteService(s: Service) {
    setError(null);
    const { error: err } = await supabase.from('services').delete().eq('id', s.id);
    setPendingDeleteId(null);
    if (err) { setError(err.message); return; }
    if (editingId === s.id) setEditingId(null);
    await load();
  }
  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title={tr('svc.title')}
        subtitle={tr('svc.subtitle')}
        onBack={back}
        label={tr('svc.loading')}
      />
    );
  }

  if (!businessId) {
    return (
      <Screen title={tr('svc.title')} onBack={back}>
        <EmptyState
          icon="cut-outline"
          title={tr('svc.setupFirst')}
          description={tr('svc.setupFirstDesc')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={tr('svc.title')}
      subtitle={tr('svc.subtitle')}
      onBack={back}
      footer={
        editingId ? (
          <View style={styles.footer}>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <Button
              label={saving ? tr('cli.saving') : editingId === 'new' ? tr('svc.addIt') : tr('common.save')}
              icon="checkmark"
              loading={saving}
              onPress={() => void saveDraft()}
            />
            <Button
              label={tr('svc.discard')}
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
            <Button label={tr('svc.add')} icon="add" onPress={startNew} />
          </View>
        )
      }
    >
      {editingId ? (
        <>
          <SectionTitle>{editingId === 'new' ? tr('svc.newSvc') : tr('svc.editSvc')}</SectionTitle>
          <Field
            label={tr('svc.name')}
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder={tr('svc.namePh')}
            icon="cut-outline"
            autoCapitalize="sentences"
          />
          <Field
            label={tr('svc.desc')}
            value={draft.description}
            onChangeText={(description) => setDraft((d) => ({ ...d, description }))}
            placeholder={tr('svc.descPh')}
            icon="document-text-outline"
            multiline
            numberOfLines={3}
            autoCapitalize="sentences"
            hint={tr('svc.descHint')}
          />
          <Field
            label={tr('svc.duration')}
            value={draft.duration}
            onChangeText={(duration) => setDraft((d) => ({ ...d, duration }))}
            placeholder="60"
            keyboardType="number-pad"
            icon="time-outline"
          />
          <Field
            label={tr('svc.price')}
            value={draft.price}
            onChangeText={(price) => setDraft((d) => ({ ...d, price }))}
            placeholder="0"
            keyboardType="decimal-pad"
            icon="cash-outline"
            hint={tr('svc.priceHint')}
          />
        </>
      ) : null}

      {rows.length === 0 && !editingId ? (
        <EmptyState
          icon="cut-outline"
          title={tr('svc.empty')}
          description={tr('svc.emptyDesc')}
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
              {s.description ? (
                <Text style={[styles.rowDesc, { color: t.colors.textMuted }]} numberOfLines={2}>
                  {s.description}
                </Text>
              ) : null}
              <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
                {formatDuration(s.duration_minutes)} · {formatRon(s.price)}
                {s.active ? '' : ` · ${tr('svc.inactive')}`}
              </Text>
            </Pressable>
            <View style={styles.rowRight}>
              <Pressable onPress={() => void moveService(s, -1)} hitSlop={8} accessibilityLabel={tr('common.moveUp')}>
                <Ionicons name="arrow-up" size={18} color={t.colors.textMuted} />
              </Pressable>
              <Pressable onPress={() => void moveService(s, 1)} hitSlop={8} accessibilityLabel={tr('common.moveDown')}>
                <Ionicons name="arrow-down" size={18} color={t.colors.textMuted} />
              </Pressable>
              <Pressable onPress={() => setPendingDeleteId(pendingDeleteId === s.id ? null : s.id)} hitSlop={8} accessibilityLabel={tr('common.deleteHard')}>
                <Ionicons name="trash-outline" size={18} color={t.colors.danger} />
              </Pressable>
              <Toggle
                value={s.active}
                onValueChange={() => void toggleActive(s)}
                accessibilityLabel={s.active ? tr('svc.disable') : tr('svc.enable')}
              />
              <Pressable onPress={() => startEdit(s)} hitSlop={8}>
                <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
              </Pressable>
            </View>
            {pendingDeleteId === s.id ? (
              <View style={styles.confirmBox}>
                <Text style={[styles.rowMeta, { color: t.colors.danger }]}>{tr('common.deleteConfirm')}</Text>
                <Button label={tr('common.deleteHard')} size="sm" variant="danger" onPress={() => void deleteService(s)} />
              </View>
            ) : null}
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: fontSize.md, fontWeight: '700' },
  rowDesc: { fontSize: fontSize.sm, marginTop: 2 },
  rowMeta: { fontSize: fontSize.sm },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmBox: { width: '100%', gap: spacing.sm, marginTop: spacing.sm },
});
