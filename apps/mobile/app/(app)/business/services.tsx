import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

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
import {
  deleteBusinessMediaImage,
  uploadBusinessMediaImage,
} from '@/lib/businessMedia';
import { showDialog } from '@/lib/dialog';
import { formatDuration, formatRon } from '@/lib/format';
import { trKey, useT } from '@/lib/i18n';
import { useBack } from '@/lib/nav';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { Service } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';
import { managerOnly } from '@/components/ManagerOnly';

type Draft = {
  name: string;
  description: string;
  rebookInterval: string;
  duration: string;
  price: string;
  imageUrl: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  duration: '60',
  price: '0',
  rebookInterval: '',
  imageUrl: '',
};

const THUMB_SIZE = 68;

function BusinessServicesScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [rows, setRows] = useState<Service[]>([]);
  const [error, setError] = useTransientMessage();
  const [message, setMessage] = useTransientMessage();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /** Service id, or 'draft' while uploading from the form. */
  const [imageBusy, setImageBusy] = useState<string | 'draft' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      setError(trKey('req.notAuthed'), { sticky: true });
      return;
    }
    const { data: biz, error: bErr } = await fetchMyBusinessResult(user.id);
    if (bErr) {
      setError(bErr.message, { sticky: true });
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
      setError(sErr.message, { sticky: true });
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
      rebookInterval: s.rebook_interval_days ? String(s.rebook_interval_days) : '',
      duration: String(s.duration_minutes),
      price: String(s.price ?? 0),
      imageUrl: s.image_url ?? '',
    });
  }

  async function uploadPickedUri(localUri: string): Promise<string> {
    if (!businessId) throw new Error(trKey('req.notAuthed'));
    return uploadBusinessMediaImage(localUri, businessId);
  }

  async function pickFromLibrary(): Promise<ImagePicker.ImagePickerAsset | null> {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || result.assets.length === 0) return null;
    const asset = result.assets[0];
    const mime = (asset.mimeType ?? '').toLowerCase();
    if (mime && !mime.startsWith('image/')) {
      setError(trKey('svc.imageBadType'));
      return null;
    }
    return asset;
  }

  async function takeWithCamera(): Promise<ImagePicker.ImagePickerAsset | null> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(trKey('media.uploadForbidden'));
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || result.assets.length === 0) return null;
    return result.assets[0];
  }

  async function applyDraftImage(asset: ImagePicker.ImagePickerAsset): Promise<void> {
    setImageBusy('draft');
    setError(null);
    try {
      const url = await uploadPickedUri(asset.uri);
      const old = draft.imageUrl.trim();
      setDraft((d) => ({ ...d, imageUrl: url }));
      if (old && old !== url) void deleteBusinessMediaImage(old);
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('svc.imageFail'));
    }
    setImageBusy(null);
  }

  async function clearDraftImage(): Promise<void> {
    const old = draft.imageUrl.trim();
    setDraft((d) => ({ ...d, imageUrl: '' }));
    if (old) void deleteBusinessMediaImage(old);
  }

  async function setServiceImageUrl(s: Service, url: string | null): Promise<void> {
    const old = s.image_url ?? null;
    const { error: err } = await supabase
      .from('services')
      .update({ image_url: url, updated_at: new Date().toISOString() })
      .eq('id', s.id);
    if (err) {
      setError(err.message);
      if (url) void deleteBusinessMediaImage(url);
      return;
    }
    if (old && old !== url) void deleteBusinessMediaImage(old);
    setRows((list) => list.map((row) => (row.id === s.id ? { ...row, image_url: url } : row)));
    if (editingId === s.id) {
      setDraft((d) => ({ ...d, imageUrl: url ?? '' }));
    }
  }

  async function uploadForService(
    s: Service,
    asset: ImagePicker.ImagePickerAsset
  ): Promise<void> {
    setImageBusy(s.id);
    setError(null);
    try {
      const url = await uploadPickedUri(asset.uri);
      await setServiceImageUrl(s, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('svc.imageFail'));
    }
    setImageBusy(null);
  }

  function openImageActions(s: Service) {
    if (imageBusy) return;
    if (!s.image_url) {
      showDialog({
        title: tr('svc.imageAdd'),
        actions: [
          {
            text: tr('team.fromGallery'),
            onPress: () => {
              void (async () => {
                const asset = await pickFromLibrary();
                if (asset) await uploadForService(s, asset);
              })();
            },
          },
          {
            text: tr('team.takePhoto'),
            nativeOnly: true,
            onPress: () => {
              void (async () => {
                const asset = await takeWithCamera();
                if (asset) await uploadForService(s, asset);
              })();
            },
          },
          { text: tr('common.cancel'), style: 'cancel' },
        ],
      });
      return;
    }
    showDialog({
      title: tr('svc.imageOptions'),
      actions: [
        {
          text: tr('svc.imageReplace'),
          onPress: () => {
            void (async () => {
              const asset = await pickFromLibrary();
              if (asset) await uploadForService(s, asset);
            })();
          },
        },
        {
          text: tr('svc.imageRemove'),
          style: 'destructive',
          onPress: () => {
            void setServiceImageUrl(s, null);
          },
        },
        { text: tr('common.cancel'), style: 'cancel' },
      ],
    });
  }

  async function saveDraft() {
    if (!businessId) return;
    const name = draft.name.trim();
    const description = draft.description.trim();
    const duration = parseInt(draft.duration, 10);
    const price = Number(String(draft.price).replace(',', '.'));
    const rebookRaw = draft.rebookInterval.trim();
    const rebookInterval = rebookRaw === '' ? null : parseInt(rebookRaw, 10);
    const imageUrl = draft.imageUrl.trim() || null;
    if (!name) {
      setError(trKey('svc.nameRequired'));
      return;
    }
    if (!Number.isFinite(duration) || duration < 5 || duration > 480) {
      setError(trKey('svc.badDuration'));
      return;
    }
    if (rebookInterval !== null && (!Number.isFinite(rebookInterval) || rebookInterval < 0 || rebookInterval > 365)) {
      setError(trKey('svc.badRebook'));
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
        rebook_interval_days: rebookInterval,
        price,
        image_url: imageUrl,
        sort_order: rows.reduce((max, r) => Math.max(max, r.sort_order ?? 0), -1) + 1,
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
        rebook_interval_days: rebookInterval,
        price,
        image_url: imageUrl,
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

  async function deleteService(s: Service) {
    setError(null);
    const { error: err } = await supabase.from('services').delete().eq('id', s.id);
    setPendingDeleteId(null);
    if (err) {
      setError(err.message);
      return;
    }
    if (s.image_url) void deleteBusinessMediaImage(s.image_url);
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
            {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
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
            {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
            {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}
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
          <Field
            label={tr('svc.rebook')}
            value={draft.rebookInterval}
            onChangeText={(rebookInterval) => setDraft((d) => ({ ...d, rebookInterval }))}
            placeholder=""
            keyboardType="number-pad"
            icon="repeat-outline"
            hint={tr('svc.rebookHint')}
          />
          <Text style={[styles.imageLabel, { color: t.colors.text }]}>{tr('svc.image')}</Text>
          <Text style={[styles.imageHint, { color: t.colors.textMuted }]}>{tr('svc.imageHint')}</Text>
          <View
            style={[
              styles.imageRow,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View
              style={[
                styles.formThumb,
                { borderColor: t.colors.border, backgroundColor: t.colors.bg },
              ]}
            >
              {imageBusy === 'draft' ? (
                <ActivityIndicator
                  accessibilityLabel={tr('svc.imageUploading')}
                  accessibilityRole="progressbar"
                />
              ) : draft.imageUrl.trim() ? (
                <Image source={{ uri: draft.imageUrl.trim() }} style={styles.formThumbImg} />
              ) : (
                <Ionicons name="image-outline" size={28} color={t.colors.textFaint} />
              )}
            </View>
            <View style={styles.imageBtns}>
              <Button
                label={tr('team.fromGallery')}
                variant="secondary"
                icon="image-outline"
                onPress={() => {
                  void (async () => {
                    const asset = await pickFromLibrary();
                    if (asset) await applyDraftImage(asset);
                  })();
                }}
              />
              <Button
                label={tr('team.takePhoto')}
                variant="secondary"
                icon="camera-outline"
                onPress={() => {
                  void (async () => {
                    const asset = await takeWithCamera();
                    if (asset) await applyDraftImage(asset);
                  })();
                }}
              />
              {draft.imageUrl.trim() ? (
                <Button
                  label={tr('svc.imageRemove')}
                  variant="secondary"
                  icon="trash-outline"
                  onPress={() => void clearDraftImage()}
                />
              ) : null}
            </View>
          </View>
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
            <View style={styles.rowMain}>
              <Pressable accessibilityRole="button" onPress={() => startEdit(s)} style={styles.rowText}>
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
              <View style={styles.rowActions}>
                <Pressable
                  onPress={() => setPendingDeleteId(pendingDeleteId === s.id ? null : s.id)}
                  accessibilityRole="button"
                  android_ripple={{ color: t.colors.accentSoft, borderless: true }}
                  style={styles.iconBtn}
                  accessibilityLabel={tr('common.deleteHard')}
                >
                  <Ionicons name="trash-outline" size={18} color={t.colors.danger} />
                </Pressable>
                <Toggle
                  value={s.active}
                  onValueChange={() => void toggleActive(s)}
                  accessibilityLabel={s.active ? tr('svc.disable') : tr('svc.enable')}
                />
              </View>
            </View>
            <Pressable
              onPress={() => openImageActions(s)}
              accessibilityRole="button"
              accessibilityLabel={s.image_url ? tr('svc.imageOptions') : tr('svc.imageAdd')}
              style={[
                styles.thumb,
                { borderColor: t.colors.border, backgroundColor: t.colors.bg },
              ]}
            >
              {imageBusy === s.id ? (
                <ActivityIndicator accessibilityLabel={tr('svc.imageUploading')} />
              ) : s.image_url ? (
                <Image source={{ uri: s.image_url }} style={styles.thumbImg} />
              ) : (
                <Ionicons name="image-outline" size={22} color={t.colors.textFaint} />
              )}
            </Pressable>
            <Pressable
              onPress={() => startEdit(s)}
              accessibilityRole="button"
              android_ripple={{ color: t.colors.accentSoft, borderless: true }}
              style={styles.iconBtn}
              accessibilityLabel={tr('common.edit')}
            >
              <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
            </Pressable>
            {pendingDeleteId === s.id ? (
              <View style={styles.confirmBox}>
                <Text style={[styles.rowMeta, { color: t.colors.danger }]}>{tr('common.deleteConfirm')}</Text>
                <Button
                  label={tr('common.deleteHard')}
                  size="sm"
                  variant="danger"
                  onPress={() => void deleteService(s)}
                />
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
  rowMain: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 140, gap: spacing.sm },
  rowText: { gap: 2 },
  rowName: { fontSize: fontSize.md, fontWeight: '700' },
  rowDesc: { fontSize: fontSize.sm, marginTop: 2 },
  rowMeta: { fontSize: fontSize.sm },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  iconBtn: {
    width: spacing.touchTarget,
    height: spacing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbImg: { width: '100%', height: '100%' },
  confirmBox: { width: '100%', gap: spacing.sm, marginTop: spacing.sm },
  imageLabel: { fontSize: fontSize.sm, fontWeight: '700', marginTop: spacing.sm },
  imageHint: { fontSize: fontSize.sm, marginBottom: spacing.sm },
  imageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginBottom: spacing.md,
  },
  formThumb: {
    width: 88,
    height: 88,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  formThumbImg: { width: '100%', height: '100%' },
  imageBtns: { flex: 1, minWidth: 160, gap: spacing.sm },
});

export default managerOnly(BusinessServicesScreen);
