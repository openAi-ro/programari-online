import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import {
  Button,
  Callout,
  EmptyState,
  Field,
  Screen,
  SectionTitle,
  SkeletonScreen,
  Toggle,
  useTheme,
} from '@/components/ui';
import { fontSize, radius, spacing } from '@/constants/theme';
import { getWebBookingUrl } from '@/lib/bookingLink';
import { businessCategoryText } from '@/lib/browseCategories';
import {
  COVER_MAX_WIDTH,
  GALLERY_MAX_WIDTH,
  deleteBusinessMediaImage,
  uploadBusinessMediaImage,
} from '@/lib/businessMedia';
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_GALLERY_PHOTOS,
  buildAutoDescription,
  normalizeGalleryUrls,
  removeGalleryUrl,
} from '@/lib/businessPage';
import { getCurrentUser } from '@/lib/currentUser';
import { trKey, useLanguage, useT } from '@/lib/i18n';
import { fetchMyBusinessResult } from '@/lib/myBusiness';
import { useBack } from '@/lib/nav';
import { normalizePhoneE164 } from '@/lib/phone';
import { supabase } from '@/lib/supabase';
import type { BusinessProfile } from '@/lib/types';
import { useTransientMessage } from '@/lib/useTransientMessage';
import { managerOnly } from '@/components/ManagerOnly';

/** Setări business: pagina publică de prezentare (/b/[publicCode]). */
function BusinessPageSettingsScreen() {
  const t = useTheme();
  const back = useBack();
  const tr = useT();
  const { lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState<BusinessProfile | null>(null);
  const [serviceNames, setServiceNames] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [gallery, setGallery] = useState<string[]>([]);
  const [contactPhone, setContactPhone] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useTransientMessage();
  const [message, setMessage] = useTransientMessage();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      const user = await getCurrentUser();
      if (!user) {
        setLoading(false);
        setError(trKey('req.notAuthed'), { sticky: true });
        return;
      }
      const { data, error: err } = await fetchMyBusinessResult(user.id);
      if (err) {
        setError(err.message, { sticky: true });
        setLoading(false);
        return;
      }
      if (data) {
        const biz = data as BusinessProfile;
        setBusiness(biz);
        setDescription(biz.description ?? '');
        setCoverUrl(biz.cover_url ?? null);
        setGallery(normalizeGalleryUrls(biz.gallery_urls));
        setContactPhone(biz.contact_phone ?? '');
        setEnabled(biz.website_enabled !== false);
        const { data: svcRows } = await supabase
          .from('services')
          .select('name')
          .eq('business_id', biz.id)
          .eq('active', true)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })
          .order('id', { ascending: true });
        setServiceNames(
          (svcRows ?? []).map((s) => String((s as { name?: unknown })?.name ?? '')).filter(Boolean)
        );
      }
      setLoading(false);
    })();
  }, []);

  async function pickCover() {
    if (!business) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setUploadBusy(true);
    setError(null);
    try {
      const url = await uploadBusinessMediaImage(asset.uri, business.id, {
        maxWidth: COVER_MAX_WIDTH,
        sourceWidth: asset.width,
      });
      const old = coverUrl;
      setCoverUrl(url);
      if (old) void deleteBusinessMediaImage(old);
      setMessage(trKey('pageEdit.saved'));
    } catch {
      setError(trKey('pageEdit.uploadFail'));
    }
    setUploadBusy(false);
  }

  async function pickGallery() {
    if (!business) return;
    if (gallery.length >= MAX_GALLERY_PHOTOS) {
      setError(trKey('pageEdit.tooMany', { max: MAX_GALLERY_PHOTOS }));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    setUploadBusy(true);
    setError(null);
    try {
      let urls = gallery;
      for (const asset of result.assets) {
        if (urls.length >= MAX_GALLERY_PHOTOS) break;
        const url = await uploadBusinessMediaImage(asset.uri, business.id, {
          maxWidth: GALLERY_MAX_WIDTH,
          sourceWidth: asset.width,
        });
        if (!urls.includes(url)) urls = [...urls, url];
      }
      setGallery(urls);
    } catch {
      setError(trKey('pageEdit.uploadFail'));
    }
    setUploadBusy(false);
  }

  function removeGalleryPhoto(url: string) {
    setGallery((g) => removeGalleryUrl(g, url));
    void deleteBusinessMediaImage(url);
  }

  function removeCover() {
    const old = coverUrl;
    setCoverUrl(null);
    if (old) void deleteBusinessMediaImage(old);
  }

  function generateDescription() {
    if (!business) return;
    setDescription(
      buildAutoDescription({
        name: business.name,
        categoryLabel: businessCategoryText(business, lang),
        city: business.city,
        county: business.county,
        serviceNames,
        lang,
      }).slice(0, MAX_DESCRIPTION_LENGTH)
    );
  }

  async function handleSave() {
    if (!business) return;
    setError(null);
    setMessage(null);
    const desc = description.trim();
    if (desc.length > MAX_DESCRIPTION_LENGTH) {
      setError(trKey('pageEdit.descTooLong'));
      return;
    }
    const phoneTrim = contactPhone.trim();
    const e164 = phoneTrim ? normalizePhoneE164(phoneTrim) : null;
    if (phoneTrim && !e164) {
      setError(trKey('set.badPhone'));
      return;
    }
    setSaving(true);
    const { error: err } = await supabase
      .from('business_profiles')
      .update({
        description: desc || null,
        cover_url: coverUrl,
        gallery_urls: gallery,
        contact_phone: e164,
        website_enabled: enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', business.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setMessage(trKey('pageEdit.saved'));
  }

  async function handleCopyLink() {
    if (!business) return;
    await Clipboard.setStringAsync(getWebBookingUrl(business.public_code));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <SkeletonScreen
        title={tr('pageEdit.title')}
        onBack={back}
        blocks={5}
        label={tr('pub.loading')}
      />
    );
  }

  if (!business) {
    return (
      <Screen title={tr('pageEdit.title')} subtitle={tr('pageEdit.subtitle')} onBack={back}>
        {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
        <EmptyState
          icon="storefront-outline"
          title={tr('pageEdit.noBusiness')}
          action={
            <Button
              label={tr('qr.setupBiz')}
              icon="construct-outline"
              onPress={() => router.push('/(app)/business/setup' as never)}
            />
          }
        />
      </Screen>
    );
  }

  return (
    <Screen
      title={tr('pageEdit.title')}
      subtitle={business.name}
      onBack={back}
      footer={
        <View style={styles.footer}>
          {error ? <Callout onClose={() => setError(null)} tone="danger">{error}</Callout> : null}
          {message ? <Callout onClose={() => setMessage(null)} tone="success">{message}</Callout> : null}
          <Button
            label={saving ? tr('cli.saving') : tr('pageEdit.save')}
            icon="checkmark"
            loading={saving}
            onPress={() => void handleSave()}
          />
        </View>
      }
    >
      <SectionTitle>{tr('pageEdit.cover')}</SectionTitle>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>{tr('pageEdit.coverHint')}</Text>
      {coverUrl ? (
        <Image source={{ uri: coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : null}
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Button
            label={coverUrl ? tr('pageEdit.changeCover') : tr('pageEdit.addCover')}
            variant="secondary"
            icon="image-outline"
            loading={uploadBusy}
            onPress={() => void pickCover()}
          />
        </View>
        {coverUrl ? (
          <View style={styles.rowItem}>
            <Button
              label={tr('pageEdit.remove')}
              variant="secondary"
              icon="trash-outline"
              onPress={removeCover}
            />
          </View>
        ) : null}
      </View>

      <SectionTitle>{tr('pageEdit.gallery')}</SectionTitle>
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {tr('pageEdit.galleryHint', { max: MAX_GALLERY_PHOTOS })}
      </Text>
      {gallery.length > 0 ? (
        <View style={styles.grid}>
          {gallery.map((url) => (
            <View key={url} style={styles.thumbWrap}>
              <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tr('pageEdit.remove')}
                onPress={() => removeGalleryPhoto(url)}
                style={[styles.thumbRemove, { backgroundColor: t.colors.surface }]}
              >
                <Ionicons name="close" size={16} color={t.colors.text} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Button
        label={tr('pageEdit.addPhotos')}
        variant="secondary"
        icon="images-outline"
        loading={uploadBusy}
        onPress={() => void pickGallery()}
      />

      <SectionTitle>{tr('pageEdit.description')}</SectionTitle>
      <Field
        label={tr('pageEdit.description')}
        placeholder={tr('pageEdit.descriptionPh')}
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={5}
        maxLength={MAX_DESCRIPTION_LENGTH}
      />
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {description.length}/{MAX_DESCRIPTION_LENGTH}
      </Text>
      <Button
        label={tr('pageEdit.generate')}
        variant="secondary"
        icon="sparkles-outline"
        onPress={generateDescription}
      />

      <SectionTitle>{tr('pageEdit.contactPhone')}</SectionTitle>
      <Field
        label={tr('pageEdit.contactPhone')}
        placeholder={tr('pageEdit.contactPhonePh')}
        keyboardType="phone-pad"
        value={contactPhone}
        onChangeText={setContactPhone}
      />
      <Text style={[styles.hint, { color: t.colors.textMuted }]}>
        {tr('pageEdit.contactPhoneHint')}
      </Text>

      <SectionTitle>{tr('pageEdit.enabled')}</SectionTitle>
      <View
        style={[
          styles.toggleRow,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        ]}
      >
        <View style={styles.toggleText}>
          <Text style={[styles.toggleTitle, { color: t.colors.text }]}>
            {tr('pageEdit.enabled')}
          </Text>
          {!enabled ? (
            <Text style={[styles.hint, { color: t.colors.textMuted }]}>
              {tr('pageEdit.enabledHint')}
            </Text>
          ) : null}
        </View>
        <Toggle
          value={enabled}
          onValueChange={setEnabled}
          accessibilityLabel={tr('pageEdit.enabled')}
        />
      </View>

      <SectionTitle>{tr('qr.publicLink')}</SectionTitle>
      <Text style={[styles.hint, { color: t.colors.textMuted }]} selectable>
        {getWebBookingUrl(business.public_code)}
      </Text>
      <View style={styles.row}>
        <View style={styles.rowItem}>
          <Button
            label={tr('pageEdit.viewPage')}
            variant="secondary"
            icon="open-outline"
            onPress={() => void Linking.openURL(getWebBookingUrl(business.public_code))}
          />
        </View>
        <View style={styles.rowItem}>
          <Button
            label={copied ? tr('pageEdit.copied') : tr('pageEdit.copyLink')}
            variant="secondary"
            icon={copied ? 'checkmark' : 'copy-outline'}
            onPress={() => void handleCopyLink()}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  hint: { fontSize: fontSize.sm, lineHeight: 19 },
  cover: { width: '100%', height: 190, borderRadius: radius.lg },
  row: { flexDirection: 'row', gap: spacing.md },
  rowItem: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumbWrap: { width: '31%', aspectRatio: 1 },
  thumb: { width: '100%', height: '100%', borderRadius: radius.md },
  thumbRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: fontSize.md, fontWeight: '700' },
});

export default managerOnly(BusinessPageSettingsScreen);
