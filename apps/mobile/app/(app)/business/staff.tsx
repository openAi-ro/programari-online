import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';

import { StaffBadge } from '@/components/StaffBadge';
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
  photoUrl: string;
  customHours: boolean;
  workingHours: WorkingHours;
  breakHours: BreakHours;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  photoUrl: '',
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
  const [photoBusy, setPhotoBusy] = useState(false);

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
      photoUrl: s.photo_url ?? '',
      customHours: Boolean(s.working_hours),
      workingHours: s.working_hours ?? DEFAULT_WORKING_HOURS,
      breakHours: s.break_hours ?? DEFAULT_BREAK_HOURS,
    });
  }

  async function uploadStaffPhoto(localUri: string): Promise<string> {
    if (!businessId) throw new Error('Lipsește business-ul.');
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
      setMessage('Poza a fost încărcată.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut încărca poza.');
    }
    setPhotoBusy(false);
  }

  async function pickFromGallery(): Promise<void> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la galerie ca să alegi poza.');
      return;
    }
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
      setError('Permite accesul la cameră ca să faci poza.');
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
      setError('Introdu numele specialistului.');
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
      setMessage('Specialist adăugat.');
      await load();
      return;
    }
    const { error: err } = await supabase
      .from('staff')
      .update({
        name,
        photo_url: photoUrl,
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
              styles.photoRow,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <StaffBadge
              name={draft.name.trim() || 'Specialist'}
              photoUrl={draft.photoUrl.trim() || null}
              size={88}
            />
            {photoBusy ? (
              <View style={styles.photoBusy}>
                <ActivityIndicator />
                <Text style={[styles.rowMeta, { color: t.colors.textMuted }]}>
                  Se încarcă poza…
                </Text>
              </View>
            ) : (
              <View style={styles.photoBtns}>
                <Button
                  label="Alege din galerie"
                  variant="secondary"
                  icon="image-outline"
                  onPress={() => void pickFromGallery()}
                />
                <Button
                  label="Fă poză"
                  variant="secondary"
                  icon="camera-outline"
                  onPress={() => void takePhoto()}
                />
                {draft.photoUrl.trim() ? (
                  <Button
                    label="Șterge poza"
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
            <StaffBadge name={s.name} photoUrl={s.photo_url} color={s.color} size={52} />
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
