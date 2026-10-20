import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';

import { StaffBadge } from '@/components/StaffBadge';
import { BreakHoursForm } from '@/components/BreakHoursForm';
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
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import {
  MAX_PORTFOLIO_PHOTOS,
  addPortfolioUrl,
  normalizePortfolioUrls,
  removePortfolioUrl,
} from '@/lib/staffPortfolio';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { BreakHours, Staff, WorkingHours } from '@/lib/types';

type Draft = {
  name: string;
  photoUrl: string;
  portfolioUrls: string[];
  customHours: boolean;
  workingHours: WorkingHours;
  breakHours: BreakHours;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  photoUrl: '',
  portfolioUrls: [],
  customHours: false,
  workingHours: DEFAULT_WORKING_HOURS,
  breakHours: DEFAULT_BREAK_HOURS,
};

export default function BusinessStaffScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rows, setRows] = useState<Staff[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [photoBusy, setPhotoBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
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
      photoUrl: s.photo_url ?? '',
      portfolioUrls: normalizePortfolioUrls(s.portfolio_urls),
      customHours: Boolean(s.working_hours),
      workingHours: s.working_hours ?? DEFAULT_WORKING_HOURS,
      breakHours: s.break_hours ?? DEFAULT_BREAK_HOURS,
    });
  }

  async function uploadStaffPhoto(localUri: string): Promise<string> {
    if (!businessId) throw new Error(trKey('team.bizMissing'));
    const { buffer, contentType, ext } = await readLocalImageBytes(localUri);
    const path = `${businessId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('staff-photos').upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('staff-photos').getPublicUrl(path);
    return data.publicUrl;
  }

  async function handlePhotoResult(
    result: ImagePicker.ImagePickerResult
  ): Promise<void> {
    if (result.canceled || result.assets.length === 0) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const url = await uploadStaffPhoto(result.assets[0].uri);
      setDraft((d) => ({ ...d, photoUrl: url }));
      setMessage(trKey('team.photoUp'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('team.photoFail'));
    }
    setPhotoBusy(false);
  }

  async function pickPortfolioPhotos(): Promise<void> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    setPhotoBusy(true);
    setError(null);
    try {
      let urls = draft.portfolioUrls;
      for (const asset of result.assets) {
        if (urls.length >= MAX_PORTFOLIO_PHOTOS) break;
        const url = await uploadStaffPhoto(asset.uri);
        urls = addPortfolioUrl(urls, url);
      }
      setDraft((d) => ({ ...d, portfolioUrls: urls }));
      setMessage(trKey('team.photoUp'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('team.photoFail'));
    }
    setPhotoBusy(false);
  }

  async function pickFromGallery(): Promise<void> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    await handlePhotoResult(result);
  }

  async function takePhoto(): Promise<void> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(trKey('team.cameraPerm'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    await handlePhotoResult(result);
  }

  async function saveDraft() {
    if (!businessId) return;
    const name = draft.name.trim();
    if (!name) {
      setError(trKey('team.nameRequired'));
      return;
    }
    const hours = draft.customHours
      ? { working_hours: draft.workingHours, break_hours: draft.breakHours }
      : { working_hours: null, break_hours: null };
    setSaving(true);
    setError(null);
    setMessage(null);
    const photoUrl = draft.photoUrl.trim() || null;
    if (editingId === 'new') {
      const { error: err } = await supabase.from('staff').insert({
        business_id: businessId,
        portfolio_urls: normalizePortfolioUrls(draft.portfolioUrls),
        name,
        photo_url: photoUrl,
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
      setMessage(trKey('team.added'));
      await load();
      return;
    }
    const { error: err } = await supabase
      .from('staff')
      .update({
        name,
        photo_url: photoUrl,
        portfolio_urls: normalizePortfolioUrls(draft.portfolioUrls),
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
    setMessage(trKey('team.updated'));
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

  async function moveStaff(s: Staff, dir: -1 | 1) {
    const idx = rows.findIndex((r) => r.id === s.id);
    const other = rows[idx + dir];
    if (!other) return;
    setError(null);
    const a = await supabase.from('staff').update({ sort_order: other.sort_order, updated_at: new Date().toISOString() }).eq('id', s.id);
    if (a.error) { setError(a.error.message); return; }
    const b = await supabase.from('staff').update({ sort_order: s.sort_order, updated_at: new Date().toISOString() }).eq('id', other.id);
    if (b.error) { setError(b.error.message); return; }
    await load();
  }

  async function deleteStaff(s: Staff) {
    setError(null);
    const { error: err } = await supabase.from('staff').delete().eq('id', s.id);
    setPendingDeleteId(null);
    if (err) { setError(err.message); return; }
    if (editingId === s.id) setEditingId(null);
    await load();
  }
  if (loading && rows.length === 0) {
    return (
      <ListLoadingScreen
        title={tr('team.title')}
        subtitle={tr('team.subtitle')}
        onBack={back}
        label={tr('team.loading')}
      />
    );
  }

  if (!businessId) {
    return (
      <Screen title={tr('team.title')} onBack={back}>
        <EmptyState
          icon="people-outline"
          title={tr('team.setupFirst')}
          description={tr('team.setupFirstDesc')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={tr('team.title')}
      subtitle={tr('team.subtitle')}
      onBack={back}
      footer={
        editingId ? (
          <View style={styles.footer}>
            {error ? <Callout tone="danger">{error}</Callout> : null}
            <Button
              label={saving ? tr('cli.saving') : editingId === 'new' ? tr('team.addShort') : tr('common.save')}
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
            <Button label={tr('team.add')} icon="add" onPress={startNew} />
          </View>
        )
      }
    >
      {editingId ? (
        <>
          <SectionTitle>{editingId === 'new' ? tr('team.newOne') : tr('common.edit')}</SectionTitle>
          <Field
            label={tr('svc.name')}
            value={draft.name}
            onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
            placeholder={tr('team.namePh')}
            icon="person-outline"
            autoCapitalize="words"
          />
          <View
            style={[
              styles.photoRow,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <StaffBadge
              name={draft.name.trim() || tr('team.specialist')}
              photoUrl={draft.photoUrl.trim() || null}
              size={88}
            />
            {photoBusy ? (
              <View style={styles.photoBusy}>
                <ActivityIndicator />
                <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
                  {tr('team.photoLoading')}
                </Text>
              </View>
            ) : (
              <View style={styles.photoBtns}>
                <Button
                  label={tr('team.fromGallery')}
                  variant="secondary"
                  icon="image-outline"
                  onPress={() => void pickFromGallery()}
                />
                <Button
                  label={tr('team.takePhoto')}
                  variant="secondary"
                  icon="camera-outline"
                  onPress={() => void takePhoto()}
                />
                {draft.photoUrl.trim() ? (
                  <Button
                    label={tr('team.delPhoto')}
                    variant="secondary"
                    icon="trash-outline"
                    onPress={() => setDraft((d) => ({ ...d, photoUrl: '' }))}
                  />
                ) : null}
              </View>
            )}
          </View>
          <View
            style={[
              styles.portfolioBox,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <Text style={[styles.toggleTitle, { color: t.colors.text }]}>{tr('team.portfolio')}</Text>
            <Text style={[styles.toggleSub, { color: t.colors.textMuted }]}>
              {tr('team.portfolioHint', { max: MAX_PORTFOLIO_PHOTOS })}
            </Text>
            {draft.portfolioUrls.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workRow}>
                {draft.portfolioUrls.map((uri) => (
                  <View key={uri} style={styles.workItem}>
                    <Image source={{ uri }} style={styles.workThumb} />
                    <Button
                      label={tr('team.delWork')}
                      variant="secondary"
                      size="sm"
                      icon="trash-outline"
                      onPress={() =>
                        setDraft((d) => ({ ...d, portfolioUrls: removePortfolioUrl(d.portfolioUrls, uri) }))
                      }
                    />
                  </View>
                ))}
              </ScrollView>
            ) : null}
            <Button
              label={tr('team.addWork')}
              variant="secondary"
              icon="images-outline"
              loading={photoBusy}
              disabled={draft.portfolioUrls.length >= MAX_PORTFOLIO_PHOTOS}
              onPress={() => void pickPortfolioPhotos()}
            />
          </View>
          <View
            style={[
              styles.toggleRow,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.toggleTitle, { color: t.colors.text }]}>{tr('team.customHours')}</Text>
              <Text style={[styles.toggleSub, { color: t.colors.textMuted }]}>
                {tr('team.customHint')}
              </Text>
            </View>
            <Toggle
              value={draft.customHours}
              onValueChange={(customHours) => setDraft((d) => ({ ...d, customHours }))}
              accessibilityLabel={tr('team.customHours')}
            />
          </View>
          {draft.customHours ? (
            <>
            <WorkingHoursForm
              value={draft.workingHours}
              onChange={(workingHours) => setDraft((d) => ({ ...d, workingHours }))}
            />
            <BreakHoursForm
              value={draft.breakHours}
              onChange={(breakHours) => setDraft((d) => ({ ...d, breakHours }))}
            />
            </>
          ) : null}
        </>
      ) : null}

      {rows.length === 0 && !editingId ? (
        <EmptyState
          icon="people-outline"
          title={tr('team.empty')}
          description={tr('team.emptyDesc')}
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
            <StaffBadge name={s.name} photoUrl={s.photo_url} color={s.color} size={52} />
            <Pressable onPress={() => startEdit(s)} style={styles.rowText}>
              <Text style={[styles.rowName, { color: t.colors.text }]} numberOfLines={2} ellipsizeMode="tail">
                {s.name}
              </Text>
              <Text style={[styles.rowMeta, { color: t.colors.textMuted }]} numberOfLines={1} ellipsizeMode="tail">
                {s.working_hours ? tr('team.customHours') : tr('team.bizHours')}
                {s.active ? '' : ` · ${tr('svc.inactive')}`}
              </Text>
            </Pressable>
            <View style={styles.rowActions}>
            <Pressable onPress={() => void moveStaff(s, -1)} hitSlop={8} accessibilityLabel={tr('common.moveUp')}>
              <Ionicons name="arrow-up" size={18} color={t.colors.textMuted} />
            </Pressable>
            <Pressable onPress={() => void moveStaff(s, 1)} hitSlop={8} accessibilityLabel={tr('common.moveDown')}>
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
                <Button label={tr('common.deleteHard')} size="sm" variant="danger" onPress={() => void deleteStaff(s)} />
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
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  photoBusy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  photoBtns: { flex: 1, gap: spacing.sm },
  flex: { flex: 1, gap: 2 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  portfolioBox: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  workRow: { gap: spacing.sm },
  workItem: { gap: spacing.xs, alignItems: 'center' },
  workThumb: { width: 96, height: 96, borderRadius: radius.md },
  toggleTitle: { fontSize: fontSize.md, fontWeight: '600' },
  toggleSub: { fontSize: fontSize.sm, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  confirmBox: { width: '100%', gap: spacing.sm, marginTop: spacing.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  // Textul ia latimea ramasa; pe ecran ingust actiunile trec pe randul urmator.
  rowText: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 140, gap: 2 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginLeft: 'auto' },
  rowName: { fontSize: fontSize.md, fontWeight: '700' },
  rowMeta: { fontSize: fontSize.sm },
});
