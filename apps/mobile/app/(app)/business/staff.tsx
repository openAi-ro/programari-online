import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';

import { StaffBadge } from '@/components/StaffBadge';
import { StaffUnavailabilitySection } from '@/components/StaffUnavailabilitySection';
import { TeamAccessSection } from '@/components/TeamAccessSection';
import { fetchBusinessRole, type BusinessRole } from '@/lib/businessMembers';
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
import {
  MAX_SPECIALTY_LENGTH,
  MAX_STAFF_EMAIL_LENGTH,
  MAX_STAFF_PHONE_LENGTH,
  cleanOptionalText,
  isValidStaffEmail,
  staffPrivateRow,
} from '@/lib/staffDetails';
import { initialServiceSelection, staffServicesPlan } from '@/lib/staffServices';
import { supabase } from '@/lib/supabase';
import { getCurrentUser } from '@/lib/currentUser';
import type { BreakHours, Staff, WorkingHours } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';

type Draft = {
  name: string;
  specialty: string;
  phone: string;
  phonePublic: boolean;
  /** Email privat (doar proprietarul il vede). */
  email: string;
  /** Serviciile bifate („Servicii oferite”). */
  serviceIds: string[];
  photoUrl: string;
  portfolioUrls: string[];
  customHours: boolean;
  workingHours: WorkingHours;
  breakHours: BreakHours;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  specialty: '',
  phone: '',
  phonePublic: false,
  email: '',
  serviceIds: [],
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
  const [error, setError] = useTransientMessage();
  const [message, setMessage] = useTransientMessage();
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  // Rândurile staff_services salvate pentru specialistul editat (pentru diferență la salvare).
  const [savedServiceIds, setSavedServiceIds] = useState<string[]>([]);
  const [myRole, setMyRole] = useState<BusinessRole | null>(null);

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
    setMyRole(await fetchBusinessRole(biz.id));
    const [{ data, error: sErr }, { data: svcRows, error: svcErr }] = await Promise.all([
      supabase
        .from('staff')
        .select('*')
        .eq('business_id', biz.id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('services')
        .select('id, name')
        .eq('business_id', biz.id)
        .eq('active', true)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
    ]);
    if (sErr || svcErr) {
      setError((sErr ?? svcErr)?.message ?? trKey('team.saveFail'), { sticky: true });
    } else {
      setRows((data ?? []) as Staff[]);
      setServices((svcRows ?? []) as { id: string; name: string }[]);
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
    setSavedServiceIds([]);
    setDraft({ ...EMPTY_DRAFT, serviceIds: services.map((s) => s.id) });
  }

  async function startEdit(s: Staff) {
    setMessage(null);
    setError(null);
    setEditingId(s.id);
    setDraft({
      name: s.name,
      specialty: s.specialty ?? '',
      phone: '',
      phonePublic: false,
      email: '',
      serviceIds: services.map((x) => x.id),
      photoUrl: s.photo_url ?? '',
      portfolioUrls: normalizePortfolioUrls(s.portfolio_urls),
      customHours: Boolean(s.working_hours),
      workingHours: s.working_hours ?? DEFAULT_WORKING_HOURS,
      breakHours: s.break_hours ?? DEFAULT_BREAK_HOURS,
    });
    setSavedServiceIds([]);
    // Telefonul si emailul stau in staff_private (doar proprietarul le poate citi).
    const [{ data: priv, error: pErr }, { data: offered, error: oErr }] = await Promise.all([
      supabase
        .from('staff_private')
        .select('phone, phone_public, email')
        .eq('staff_id', s.id)
        .maybeSingle(),
      supabase.from('staff_services').select('service_id').eq('staff_id', s.id),
    ]);
    if (pErr || oErr) {
      setError((pErr ?? oErr)?.message ?? trKey('team.saveFail'));
      return;
    }
    const saved = ((offered ?? []) as { service_id: string }[]).map((r) => r.service_id);
    setSavedServiceIds(saved);
    setDraft((d) => ({
      ...d,
      serviceIds: initialServiceSelection(saved, services.map((x) => x.id)),
    }));
    if (priv) {
      setDraft((d) => ({
        ...d,
        phone: priv.phone ?? '',
        phonePublic: Boolean(priv.phone_public),
        email: priv.email ?? '',
      }));
    }
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

  /** Scrie diferența „Servicii oferite” (toate bifate = niciun rând = face tot). */
  async function saveStaffServices(
    staffId: string,
    plan: { insertIds: string[]; deleteIds: string[] }
  ): Promise<string | null> {
    if (plan.deleteIds.length > 0) {
      const { error: dErr } = await supabase
        .from('staff_services')
        .delete()
        .eq('staff_id', staffId)
        .in('service_id', plan.deleteIds);
      if (dErr) return dErr.message;
    }
    if (plan.insertIds.length > 0) {
      const { error: iErr } = await supabase
        .from('staff_services')
        .insert(plan.insertIds.map((serviceId) => ({ staff_id: staffId, service_id: serviceId })));
      if (iErr) return iErr.message;
    }
    return null;
  }

  async function saveDraft() {
    if (!businessId) return;
    const name = draft.name.trim();
    if (!name) {
      setError(trKey('team.nameRequired'));
      return;
    }
    const servicePlan = staffServicesPlan(
      draft.serviceIds,
      services.map((s) => s.id),
      editingId === 'new' ? [] : savedServiceIds
    );
    if (servicePlan.error) {
      setError(trKey('staff.servicesNone'));
      return;
    }
    if (!isValidStaffEmail(draft.email)) {
      setError(trKey('staff.emailInvalid'));
      return;
    }
    const hours = draft.customHours
      ? { working_hours: draft.workingHours, break_hours: draft.breakHours }
      : { working_hours: null, break_hours: null };
    setSaving(true);
    setError(null);
    setMessage(null);
    const photoUrl = draft.photoUrl.trim() || null;
    const specialty = cleanOptionalText(draft.specialty, MAX_SPECIALTY_LENGTH);
    if (editingId === 'new') {
      const { data: created, error: err } = await supabase
        .from('staff')
        .insert({
          business_id: businessId,
          portfolio_urls: normalizePortfolioUrls(draft.portfolioUrls),
          name,
          specialty,
          photo_url: photoUrl,
          color: STAFF_COLORS[rows.length % STAFF_COLORS.length],
          sort_order: rows.reduce((max, r) => Math.max(max, r.sort_order ?? 0), -1) + 1,
          active: true,
          ...hours,
        })
        .select('id')
        .single();
      if (err || !created) {
        setSaving(false);
        setError(err?.message ?? trKey('team.saveFail'));
        return;
      }
      const { error: pErr } = await supabase
        .from('staff_private')
        .upsert(
          staffPrivateRow({
            staffId: created.id,
            phone: draft.phone,
            phonePublic: draft.phonePublic,
            email: draft.email,
          })
        );
      const sErr = pErr ? null : await saveStaffServices(created.id, servicePlan);
      setSaving(false);
      if (pErr || sErr) {
        setEditingId(created.id);
        setError(pErr?.message ?? sErr);
        await load();
        return;
      }
      setEditingId(null);
      setMessage(trKey('team.added'));
      await load();
      return;
    }
    if (!editingId) {
      setSaving(false);
      return;
    }
    const { error: err } = await supabase
      .from('staff')
      .update({
        name,
        specialty,
        photo_url: photoUrl,
        portfolio_urls: normalizePortfolioUrls(draft.portfolioUrls),
        ...hours,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editingId);
    if (err) {
      setSaving(false);
      setError(err.message);
      return;
    }
    const { error: pErr } = await supabase
      .from('staff_private')
      .upsert(
        staffPrivateRow({
          staffId: editingId,
          phone: draft.phone,
          phonePublic: draft.phonePublic,
          email: draft.email,
        })
      );
    const sErr = pErr ? null : await saveStaffServices(editingId, servicePlan);
    setSaving(false);
    if (pErr || sErr) {
      setError(pErr?.message ?? sErr);
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
            {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
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
            {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
            {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}
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
          <Field
            label={tr('staff.specialty')}
            value={draft.specialty}
            onChangeText={(specialty) => setDraft((d) => ({ ...d, specialty }))}
            placeholder={tr('staff.specialtyPh')}
            icon="ribbon-outline"
            autoCapitalize="sentences"
            maxLength={MAX_SPECIALTY_LENGTH}
          />
          <Field
            label={tr('staff.phone')}
            value={draft.phone}
            onChangeText={(phone) => setDraft((d) => ({ ...d, phone }))}
            placeholder="07…"
            icon="call-outline"
            keyboardType="phone-pad"
            maxLength={MAX_STAFF_PHONE_LENGTH}
          />
          <View
            style={[
              styles.toggleRow,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
            ]}
          >
            <View style={styles.flex}>
              <Text style={[styles.toggleTitle, { color: t.colors.text }]}>
                {tr('staff.phonePublic')}
              </Text>
              <Text style={[styles.toggleSub, { color: t.colors.textMuted }]}>
                {tr('staff.phonePublicHint')}
              </Text>
            </View>
            <Toggle
              value={draft.phonePublic}
              onValueChange={(phonePublic) => setDraft((d) => ({ ...d, phonePublic }))}
              accessibilityLabel={tr('staff.phonePublic')}
            />
          </View>
          <Field
            label={tr('staff.email')}
            value={draft.email}
            onChangeText={(email) => setDraft((d) => ({ ...d, email }))}
            placeholder={tr('staff.emailPh')}
            hint={tr('staff.emailHint')}
            error={isValidStaffEmail(draft.email) ? null : tr('staff.emailInvalid')}
            icon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            inputMode="email"
            maxLength={MAX_STAFF_EMAIL_LENGTH}
          />
          {services.length > 0 ? (
            <View
              style={[
                styles.servicesBox,
                { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              ]}
            >
              <Text style={[styles.toggleTitle, { color: t.colors.text }]}>
                {tr('staff.services')}
              </Text>
              <Text style={[styles.toggleSub, { color: t.colors.textMuted }]}>
                {tr('staff.servicesHint')}
              </Text>
              {services.map((svc) => {
                const on = draft.serviceIds.includes(svc.id);
                return (
                  <Pressable
                    key={svc.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={svc.name}
                    onPress={() =>
                      setDraft((d) => ({
                        ...d,
                        serviceIds: on
                          ? d.serviceIds.filter((id) => id !== svc.id)
                          : [...d.serviceIds, svc.id],
                      }))
                    }
                    style={styles.serviceCheck}
                  >
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={on ? t.colors.accent : t.colors.textMuted}
                    />
                    <Text style={[styles.serviceCheckText, { color: t.colors.text }]}>{svc.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
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

      {!editingId && businessId ? (
        <TeamAccessSection
          businessId={businessId}
          staffList={rows.map((s) => ({ id: s.id, name: s.name }))}
          myRole={myRole}
        />
      ) : null}

      {editingId && editingId !== 'new' && businessId ? (
        <StaffUnavailabilitySection businessId={businessId} staffId={editingId} />
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
            <Pressable onPress={() => void startEdit(s)} style={styles.rowText}>
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
            <Pressable onPress={() => void startEdit(s)} hitSlop={8}>
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
  servicesBox: { borderWidth: 1, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs },
  serviceCheck: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  serviceCheckText: { fontSize: fontSize.md, flex: 1 },
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
