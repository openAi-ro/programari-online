import { useEffect, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useSegments } from 'expo-router';

import { ClientTabBar } from '@/components/ClientTabBar';
import {
  Badge,
  Button,
  Callout,
  Card,
  Field,
  Screen,
  SectionTitle,
  Segmented,
  SettingRow,
  SkeletonScreen,
  Toggle,
  useTheme,
} from '@/components/ui';
import { missingVisitCardFields } from '@/components/BusinessVisitCard';
import { markNavReady, measureBeforeEnabled } from '@/lib/navTiming';
import { fontSize, radius, spacing } from '@/constants/theme';
import { mapAuthError, signOut, updatePassword } from '@/lib/auth';
import { getAppVersionLabel } from '@/lib/appVersion';
import { parseAccountKind } from '@/lib/accountKind';
import { getAppMode, type AppMode } from '@/lib/appMode';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/lib/themePreference';
import { useBack } from '@/lib/nav';
import {
  registerForPushAsync,
  presentStatusBarTestNotification,
  openBookingChannelSettings,
  getPushDiagnostics,
  type PushDiagnostics,
} from '@/lib/notifications';
import { invokeTestWhatsApp } from '@/lib/notify-client';
import {
  formatPhoneDisplay,
  isValidRoMobile,
  normalizePhoneE164,
} from '@/lib/phone';
import { readLocalImageBytes } from '@/lib/uploadLocalImage';
import { uploadBusinessVideo } from '@/lib/businessVideo';
import { pickerDurationToMs } from '@/lib/videoRules';
import { PromoVideo } from '@/components/PromoVideo';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

export default function SettingsScreen() {
  const segments = useSegments();
  const inBusinessTabs = (segments as readonly string[]).includes('(tabs)');

  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && inBusinessTabs) {
      // eslint-disable-next-line no-console
      console.count('[TAB_MOUNT] business/settings');
    }
  }, [inBusinessTabs]);

  const t = useTheme();
  const back = useBack();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [appMode, setAppModeState] = useState<AppMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushTestBusy, setPushTestBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diag, setDiag] = useState<PushDiagnostics | null>(null);
  const [waBusy, setWaBusy] = useState(false);
  const [notifyReminders, setNotifyReminders] = useState(true);
  const [notifyDecision, setNotifyDecision] = useState(true);
  /** Caseta WhatsApp: dacă e oprită, telefonul rămâne doar contact (fără WhatsApp). */
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [bizName, setBizName] = useState('');
  const [bizPublicCode, setBizPublicCode] = useState<string | null>(null);
  const [bizHasAddress, setBizHasAddress] = useState(false);
  const [bizHasCoords, setBizHasCoords] = useState(false);
  const [hasServices, setHasServices] = useState(false);
  const [hasStaff, setHasStaff] = useState(false);
  const [pushDiagOpen, setPushDiagOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credBusy, setCredBusy] = useState(false);
  const [themePref, setThemePref] = useState<ThemePreference>('system');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getThemePreference().then(setThemePref);
  }, []);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      try {
        const wa = await AsyncStorage.getItem('settings.whatsappEnabled');
        if (wa === '0') setWhatsappEnabled(false);
        else if (wa === '1') setWhatsappEnabled(true);
      } catch {
        /* ignore */
      }
      let profileRes = await supabase
        .from('profiles')
        .select('id, email, phone, display_name, account_kind, notify_reminders, notify_decision, notify_whatsapp, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      if (profileRes.error && /notify_whatsapp/i.test(profileRes.error.message)) {
        profileRes = await supabase
          .from('profiles')
          .select('id, email, phone, display_name, account_kind, notify_reminders, notify_decision, avatar_url')
          .eq('id', user.id)
          .maybeSingle();
      }
      const data = profileRes.data;
      const authPhone = user.phone ?? null;
      if (data) {
        setProfile(data as Profile);
        setDisplayName(data.display_name ?? '');
        // Sursa de adevăr = profiles.phone. Auth e doar fallback dacă profilul e gol.
        const phone = data.phone ?? authPhone;
        setPhoneInput(phone ? formatPhoneDisplay(phone) : '');
        setNotifyReminders(data.notify_reminders !== false);
        setNotifyDecision(data.notify_decision !== false);
        // Preferință WhatsApp din DB (dacă există coloana); altfel rămâne AsyncStorage.
        if (typeof (data as Profile).notify_whatsapp === 'boolean') {
          setWhatsappEnabled((data as Profile).notify_whatsapp !== false);
        }
        setAvatarUrl((data as Profile).avatar_url ?? null);
        setAppModeState(parseAccountKind(data.account_kind));
        setEmailInput(data.email ?? user.email ?? '');
      } else {
        // Cont fără rând în profiles — totuși arătăm telefonul din auth (ex. login WhatsApp).
        setDisplayName(user.user_metadata?.display_name ?? '');
        setPhoneInput(authPhone ? formatPhoneDisplay(authPhone) : '');
        setEmailInput(user.email ?? '');
        const stored = await getAppMode();
        setAppModeState(stored);
      }
      setAuthEmail(user.email ?? null);

      // Logo firmă (separat de poza de profil).
      type BizRow = {
        id: string;
        name?: string | null;
        public_code?: string | null;
        logo_url?: string | null;
        promo_video_url?: string | null;
        county?: string | null;
        city?: string | null;
        address?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      };
      let biz: BizRow | null = null;
      {
        const full = await supabase
          .from('business_profiles')
          .select('id, name, public_code, logo_url, promo_video_url, county, city, address, latitude, longitude')
          .eq('owner_user_id', user.id)
          .maybeSingle();
        if (!full.error) {
          biz = full.data as BizRow | null;
        } else if (/promo_video_url/i.test(full.error.message)) {
          const base = await supabase
            .from('business_profiles')
            .select('id, name, public_code, logo_url, county, city, address, latitude, longitude')
            .eq('owner_user_id', user.id)
            .maybeSingle();
          biz = base.data as BizRow | null;
        } else {
          console.warn('business load failed', full.error.message);
        }
      }
      if (biz?.id) {
        setBusinessId(biz.id);
        setBizName(biz.name ?? '');
        setBizPublicCode(biz.public_code ?? null);
        setLogoUrl(biz.logo_url ?? null);
        setVideoUrl(biz.promo_video_url ?? null);
        setBizHasAddress(Boolean(biz.county || biz.city || biz.address));
        setBizHasCoords(biz.latitude != null && biz.longitude != null);
        const [{ count: svcCount }, { count: staffCount }] = await Promise.all([
          supabase
            .from('services')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', biz.id)
            .eq('active', true),
          supabase
            .from('staff')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', biz.id)
            .eq('active', true),
        ]);
        setHasServices((svcCount ?? 0) > 0);
        setHasStaff((staffCount ?? 0) > 0);
      } else {
        setBusinessId(null);
        setBizName('');
        setBizPublicCode(null);
        setLogoUrl(null);
        setVideoUrl(null);
        setBizHasAddress(false);
        setBizHasCoords(false);
        setHasServices(false);
        setHasStaff(false);
      }

      setLoading(false);
      markNavReady('settings', { hasExistingData: false, softRefresh: false });
    })();
  }, []);


  async function uploadProfileAvatar(localUri: string, userId: string): Promise<string> {
    const { buffer, contentType, ext } = await readLocalImageBytes(localUri);
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('profile-avatars').upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('profile-avatars').getPublicUrl(path);
    return data.publicUrl;
  }

  async function persistAvatarUrl(url: string | null): Promise<void> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Nu ești autentificat.');
    const cols =
      'id, email, phone, display_name, account_kind, notify_reminders, notify_decision, notify_whatsapp, avatar_url';
    if (profile?.id) {
      const { data, error } = await supabase
        .from('profiles')
        .update({ avatar_url: url })
        .eq('id', profile.id)
        .select(cols)
        .maybeSingle();
      if (error) throw error;
      if (data) setProfile(data as Profile);
    } else {
      const { data, error } = await supabase
        .from('profiles')
        .upsert(
          {
            id: user.id,
            email: user.email ?? null,
            phone: user.phone ?? null,
            avatar_url: url,
          },
          { onConflict: 'id' }
        )
        .select(cols)
        .maybeSingle();
      if (error) throw error;
      if (data) setProfile(data as Profile);
    }
    setAvatarUrl(url);
  }

  async function handleAvatarResult(result: ImagePicker.ImagePickerResult): Promise<void> {
    if (result.canceled || result.assets.length === 0) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Nu ești autentificat.');
      return;
    }
    setAvatarBusy(true);
    setError(null);
    setMessage(null);
    const localUri = result.assets[0].uri;
    // Previzualizare imediată (URI local) — nu așteptăm uploadul.
    setAvatarUrl(localUri);
    try {
      const url = await uploadProfileAvatar(localUri, user.id);
      await persistAvatarUrl(url);
      setMessage('Poza de profil a fost actualizată.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut încărca poza.');
      // Dacă uploadul eșuează, revenim la URL-ul salvat (dacă există).
      setAvatarUrl(profile?.avatar_url ?? null);
    }
    setAvatarBusy(false);
  }

  async function pickAvatarFromGallery(): Promise<void> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la galerie ca să alegi poza de profil.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    await handleAvatarResult(result);
  }

  async function takeAvatarPhoto(): Promise<void> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la cameră ca să faci poza de profil.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    await handleAvatarResult(result);
  }

  async function clearAvatar(): Promise<void> {
    setAvatarBusy(true);
    setError(null);
    try {
      await persistAvatarUrl(null);
      setMessage('Poza de profil a fost ștearsă.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut șterge poza.');
    }
    setAvatarBusy(false);
  }


  async function uploadBusinessLogo(localUri: string, bizId: string): Promise<string> {
    const { buffer, contentType, ext } = await readLocalImageBytes(localUri);
    const path = `${bizId}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('business-logos').upload(path, buffer, {
      contentType,
      upsert: true,
    });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('business-logos').getPublicUrl(path);
    return data.publicUrl;
  }

  async function persistLogoUrl(url: string | null): Promise<void> {
    if (!businessId) throw new Error('Configurează mai întâi business-ul (Configurare business).');
    const { error } = await supabase
      .from('business_profiles')
      .update({ logo_url: url })
      .eq('id', businessId);
    if (error) throw error;
    setLogoUrl(url);
  }

  async function handleLogoResult(result: ImagePicker.ImagePickerResult): Promise<void> {
    if (result.canceled || result.assets.length === 0) return;
    if (!businessId) {
      setError('Configurează business-ul înainte să adaugi logo-ul.');
      return;
    }
    setLogoBusy(true);
    setError(null);
    setMessage(null);
    const localUri = result.assets[0].uri;
    setLogoUrl(localUri);
    try {
      const url = await uploadBusinessLogo(localUri, businessId);
      await persistLogoUrl(url);
      setMessage('Logo-ul firmei a fost actualizat.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut încărca logo-ul.');
      const { data: biz } = await supabase
        .from('business_profiles')
        .select('logo_url')
        .eq('id', businessId)
        .maybeSingle();
      setLogoUrl(biz?.logo_url ?? null);
    }
    setLogoBusy(false);
  }

  async function pickLogoFromGallery(): Promise<void> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la galerie ca să alegi logo-ul.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    await handleLogoResult(result);
  }

  async function takeLogoPhoto(): Promise<void> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la cameră ca să fotografiezi logo-ul.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    await handleLogoResult(result);
  }

  async function clearLogo(): Promise<void> {
    setLogoBusy(true);
    setError(null);
    try {
      await persistLogoUrl(null);
      setMessage('Logo-ul firmei a fost șters.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut șterge logo-ul.');
    }
    setLogoBusy(false);
  }

  function openLogoPicker(): void {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      { text: 'Alege din galerie', onPress: () => void pickLogoFromGallery() },
      { text: 'Deschide camera', onPress: () => void takeLogoPhoto() },
    ];
    if (logoUrl) {
      buttons.push({
        text: 'Șterge logo',
        style: 'destructive',
        onPress: () => void clearLogo(),
      });
    }
    buttons.push({ text: 'Anulează', style: 'cancel' });
    Alert.alert(
      'Logo firmă',
      'Separat de poza ta de profil. Apare pe pagina principală business.',
      buttons
    );
  }

  async function persistVideoUrl(url: string | null): Promise<void> {
    if (!businessId) throw new Error('Configurează mai întâi business-ul (Configurare business).');
    const { error } = await supabase
      .from('business_profiles')
      .update({ promo_video_url: url })
      .eq('id', businessId);
    if (error) {
      if (/promo_video_url|business-videos|bucket/i.test(error.message)) {
        throw new Error('Video-ul nu poate fi salvat până nu aplici migrările v28/v29 (supabase db push).');
      }
      throw error;
    }
    setVideoUrl(url);
  }

  async function handleVideoResult(result: ImagePicker.ImagePickerResult): Promise<void> {
    if (result.canceled || result.assets.length === 0) return;
    if (!businessId) {
      setError('Configurează business-ul înainte să adaugi video-ul.');
      return;
    }
    setVideoBusy(true);
    setError(null);
    setMessage(null);
    const asset = result.assets[0];
    setVideoUrl(asset.uri);
    try {
      const url = await uploadBusinessVideo(asset.uri, businessId, {
        durationMs: pickerDurationToMs(asset.duration, Platform.OS),
        mimeType: asset.mimeType ?? null,
      });
      await persistVideoUrl(url);
      setMessage('Video-ul de prezentare a fost salvat. Clienții îl văd la căutare.');
    } catch (e) {
      const raw = e instanceof Error ? e.message : 'Nu am putut încărca video-ul.';
      setError(
        /bucket|storage/i.test(raw)
          ? 'Video-ul nu poate fi salvat până nu aplici migrările v28/v29 (supabase db push).'
          : raw
      );
      const { data: biz } = await supabase
        .from('business_profiles')
        .select('promo_video_url')
        .eq('id', businessId)
        .maybeSingle();
      setVideoUrl(biz?.promo_video_url ?? null);
    }
    setVideoBusy(false);
  }

  async function pickVideoFromGallery(): Promise<void> {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la galerie ca să alegi video-ul.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 90,
      });
      await handleVideoResult(result);
    } catch {
      setError('Nu am putut deschide galeria. Reîncearcă.');
    }
  }

  async function recordVideo(): Promise<void> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Permite accesul la cameră ca să înregistrezi video-ul.');
      return;
    }
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 90,
      });
      await handleVideoResult(result);
    } catch {
      setError('Nu am putut porni camera. Reîncearcă.');
    }
  }

  async function clearVideo(): Promise<void> {
    setVideoBusy(true);
    setError(null);
    try {
      await persistVideoUrl(null);
      setMessage('Video-ul de prezentare a fost șters.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut șterge video-ul.');
    }
    setVideoBusy(false);
  }

  function openVideoPicker(): void {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      { text: 'Alege din galerie', onPress: () => void pickVideoFromGallery() },
      { text: 'Înregistrează acum', onPress: () => void recordVideo() },
    ];
    if (videoUrl) {
      buttons.push({
        text: 'Șterge video',
        style: 'destructive',
        onPress: () => void clearVideo(),
      });
    }
    buttons.push({ text: 'Anulează', style: 'cancel' });
    Alert.alert(
      'Video prezentare',
      'Maxim 90 secunde, 50 MB. Apare clienților la căutare, lângă cartea de vizită.',
      buttons
    );
  }

  function openAvatarPicker(): void {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      {
        text: 'Alege din galerie',
        onPress: () => void pickAvatarFromGallery(),
      },
      {
        text: 'Deschide camera',
        onPress: () => void takeAvatarPhoto(),
      },
    ];
    if (avatarUrl) {
      buttons.push({
        text: 'Șterge poza',
        style: 'destructive',
        onPress: () => void clearAvatar(),
      });
    }
    buttons.push({ text: 'Anulează', style: 'cancel' });
    Alert.alert(
      'Poza ta de profil',
      'Doar pentru tine (client / cont). Nu e logo-ul firmei.',
      buttons
    );
  }

  async function handleSave(): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Nu ești autentificat.');
      return false;
    }

    let normalized: string | null = null;
    if (phoneInput.trim()) {
      normalized = normalizePhoneE164(phoneInput.trim());
      if (!normalized) {
        setError('Număr invalid. Folosește format 07xxxxxxxx sau +407xxxxxxxx.');
        return false;
      }
      if (!isValidRoMobile(normalized)) {
        setError('Număr invalid pentru România (mobil 07xx sau fix 02xx/03xx).');
        return false;
      }
    }

    const email = profile?.email ?? user.email ?? null;
    if (!email && !normalized) {
      setError('Trebuie email sau telefon pe cont.');
      return false;
    }

    setSaving(true);
    setError(null);
    setMessage(null);

    const fields: Record<string, unknown> = {
      display_name: displayName.trim() || null,
      phone: normalized,
      notify_reminders: notifyReminders,
      notify_decision: notifyDecision,
      notify_whatsapp: whatsappEnabled,
      ...(email ? { email } : {}),
    };

    const profileSelect =
      'id, email, phone, display_name, account_kind, notify_reminders, notify_decision, notify_whatsapp, avatar_url';
    const profileSelectLegacy =
      'id, email, phone, display_name, account_kind, notify_reminders, notify_decision, avatar_url';

    // Update/insert separat — upsert parțial a fost suspectat că nu persistă phone.
    // notify_whatsapp: dacă migrarea v31 nu e aplicată, reîncercăm fără coloană.
    let saved: Profile | null = null;
    let errMsg: string | null = null;

    async function persistFields(body: Record<string, unknown>): Promise<{
      data: Profile | null;
      error: string | null;
    }> {
      const uid = profile?.id ?? user?.id;
      if (!uid) return { data: null, error: 'Nu ești autentificat.' };
      const attempt = async (cols: string, payload: Record<string, unknown>) => {
        if (profile?.id) {
          return supabase
            .from('profiles')
            .update(payload)
            .eq('id', profile.id)
            .select(cols)
            .maybeSingle();
        }
        const ins = await supabase
          .from('profiles')
          .insert({ id: uid, ...payload, email: email })
          .select(cols)
          .maybeSingle();
        if (ins.error && /duplicate|unique/i.test(ins.error.message)) {
          return supabase
            .from('profiles')
            .update(payload)
            .eq('id', uid)
            .select(cols)
            .maybeSingle();
        }
        return ins;
      };

      let res = await attempt(profileSelect, body);
      if (res.error && /notify_whatsapp/i.test(res.error.message)) {
        const { notify_whatsapp: _drop, ...rest } = body;
        res = await attempt(profileSelectLegacy, rest);
      }
      if (res.error) return { data: null, error: res.error.message };
      return { data: res.data as Profile | null, error: null };
    }

    {
      const r = await persistFields(fields);
      if (r.error) errMsg = r.error;
      else saved = r.data;
    }

    // Verificare independentă din DB (nu ne bazăm doar pe RETURNING).
    if (!errMsg) {
      let verifyRes = await supabase
        .from('profiles')
        .select(profileSelect)
        .eq('id', user.id)
        .maybeSingle();
      if (verifyRes.error && /notify_whatsapp/i.test(verifyRes.error.message)) {
        verifyRes = await supabase
          .from('profiles')
          .select(profileSelectLegacy)
          .eq('id', user.id)
          .maybeSingle();
      }
      const { data: verify, error: vErr } = verifyRes;
      if (vErr) errMsg = vErr.message;
      else if (!verify) errMsg = 'Profilul nu există după salvare (RLS?).';
      else if ((verify.phone ?? null) !== (normalized ?? null)) {
        errMsg =
          `Telefonul nu a rămas în baza de date (am scris ${normalized ?? 'gol'}, citesc ${verify.phone ?? 'gol'}). ` +
          'Verifică conexiunea Supabase / politicile RLS pe profiles.';
      } else {
        saved = verify as Profile;
      }
    }

    setSaving(false);
    if (errMsg) {
      setError(errMsg);
      return false;
    }
    if (!saved) {
      setError('Salvarea nu a returnat profilul. Reîncearcă.');
      return false;
    }

    setProfile(saved);
    setAvatarUrl(saved.avatar_url ?? null);
    setPhoneInput(saved.phone ? formatPhoneDisplay(saved.phone) : '');
    try {
      await AsyncStorage.setItem('settings.whatsappEnabled', whatsappEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
    setMessage(
      saved.phone
        ? `Telefon salvat: ${formatPhoneDisplay(saved.phone)}. Rămâne și după ce te întorci pe Home.`
        : 'Profil actualizat. Fără număr de telefon în DB.'
    );
    return true;
  }

  async function handleTestWhatsApp() {
    if (!whatsappEnabled) {
      setError('Activează caseta WhatsApp mai jos ca să trimiți mesaje pe acest număr.');
      return;
    }
    setWaBusy(true);
    setError(null);
    setMessage(null);

    const normalized = phoneInput.trim()
      ? normalizePhoneE164(phoneInput.trim())
      : profile?.phone ?? null;

    if (phoneInput.trim() && normalized && normalized !== profile?.phone) {
      const ok = await handleSave();
      if (!ok) {
        setWaBusy(false);
        return;
      }
    }

    if (!normalized) {
      setWaBusy(false);
      setError('Adaugă numărul de telefon mai întâi (câmpul Telefon, nu WhatsApp).');
      return;
    }

    try {
      const result = await invokeTestWhatsApp();
      if (!result.ok) {
        setError(result.error ?? 'Nu s-a putut trimite mesajul test.');
        return;
      }
      if (result.data?.result?.stub) {
        setError(
          result.data.hint ??
            'WhatsApp nu e configurat pe server — mesajul a fost doar logat. Setează secrets Meta sau Twilio.'
        );
        return;
      }
      setMessage(
        `Mesaj test trimis pe WhatsApp la ${formatPhoneDisplay(result.data?.phone ?? normalized)}.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la test WhatsApp.');
    } finally {
      setWaBusy(false);
    }
  }

  async function handleReregisterPush() {
    if (!profile) return;
    setPushBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await registerForPushAsync(profile.id);
      if (result.token) {
        const local = await presentStatusBarTestNotification();
        if (local.ok) {
          setMessage(
            `Push reînregistrat. Minimalizează app-ul acum — în ${local.delaySec ?? 5}s vine testul Pop on screen. Dacă nu apare popup pe ecran, apasă „Deschide setări Pop on screen”.`
          );
        } else if (local.reason === 'channel_importance_low') {
          setMessage('Push reînregistrat, dar canalul Android e pe importance mică.');
          await openBookingChannelSettings();
          setError(
            'În setările Android: canal „Cereri programări (popup)” → activează „Pop on screen” / „Pe ecran” / importance Urgent.'
          );
        } else {
          setMessage(
            'Push reînregistrat. Testul local în bară a eșuat: ' + (local.reason ?? 'necunoscut')
          );
        }
      } else if (result.reason === 'simulator') {
        setError('Push funcționează doar pe dispozitiv fizic, nu pe simulator.');
      } else if (result.reason === 'permission_denied') {
        setError('Permisiunea pentru notificări a fost refuzată. Activeaz-o din setările telefonului.');
      } else if (result.reason === 'web_unsupported') {
        setError('Push nu e disponibil în browser. Folosește aplicația instalată pe telefon.');
      } else if (result.reason === 'push_unavailable') {
        setError(
          'Push nu e disponibil în Expo Go. Instalează build-ul APK (EAS preview) ca să primești notificări.'
        );
      } else if (result.reason === 'missing_project_id') {
        setError('Lipsește projectId EAS. Reinstalează aplicația din ultimul build.');
      } else if (
        result.reason?.toLowerCase().includes('google') ||
        result.reason?.toLowerCase().includes('firebase') ||
        result.reason?.toLowerCase().includes('fcm') ||
        result.reason?.toLowerCase().includes('google-services')
      ) {
        setError(result.reason);
      } else {
        setError(result.reason ?? 'Nu s-a putut înregistra token-ul push.');
      }
      void handleRefreshDiagnostics(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la înregistrarea push.');
    } finally {
      setPushBusy(false);
    }
  }

  async function handleStatusBarTest() {
    setPushTestBusy(true);
    setError(null);
    setMessage(null);
    try {
      const local = await presentStatusBarTestNotification();
      if (local.ok) {
        setMessage(
          `Test programat. Minimalizează app-ul ACUM — în ${local.delaySec ?? 5}s trebuie să vezi popup pe ecran (nu doar banner în app).`
        );
      } else if (local.reason === 'permission_denied') {
        setError('Permisiunea pentru notificări a fost refuzată. Activeaz-o din setările telefonului.');
      } else if (local.reason === 'channel_importance_low') {
        await openBookingChannelSettings();
        setError(
          'Canalul e pe importance mică. Activează „Pop on screen” / „Pe ecran” pentru „Cereri programări (popup)”, apoi reîncearcă testul.'
        );
      } else {
        setError(local.reason ?? 'Testul local a eșuat.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la testul din bara de status.');
    } finally {
      setPushTestBusy(false);
    }
  }

  async function handleOpenPopOnScreenSettings() {
    setError(null);
    setMessage(null);
    try {
      await openBookingChannelSettings();
      setMessage(
        'În ecranul Android: pe canalul „Cereri programări (popup)” activează „Pop on screen” / „Pe ecran” / „Afișare pe ecran”, apoi revino și rulează testul.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut deschide setările Android.');
    }
  }

  async function handleLogout() {
    setError(null);
    const { error: err } = await signOut();
    if (err) setError(err.message);
  }

  /** Verificare cap-coadă: ce lipsește ca popup-ul să vină și cu app-ul închis. */
  async function handleRefreshDiagnostics(silent = false) {
    if (!profile) return;
    if (!silent) {
      setDiagBusy(true);
      setError(null);
    }
    try {
      const d = await getPushDiagnostics(profile.id);
      setDiag(d);
      if (!silent) {
        if (
          d.permission !== 'granted' ||
          !d.channelOk ||
          (d.tokensInDb ?? 0) === 0 ||
          !d.projectIdPresent
        ) {
          setError(
            'Diagnostic push: ceva lipsește (vezi rândurile de mai jos). Apasă „Activează / reînregistrează notificările”, apoi verifică din nou.'
          );
        } else {
          setMessage('Diagnostic push: totul e OK. Popup-ul vine și cu aplicația închisă.');
        }
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Eroare la diagnostic push.');
    } finally {
      if (!silent) setDiagBusy(false);
    }
  }


  async function handleUpdateEmail() {
    const next = emailInput.trim();
    if (!next) {
      setError('Introdu adresa de email.');
      return;
    }
    if (next === (profile?.email ?? authEmail ?? '')) {
      setMessage('Emailul e deja acesta.');
      return;
    }
    setCredBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: updErr } = await supabase.auth.updateUser({ email: next });
      if (updErr) {
        setError(mapAuthError(updErr) ?? updErr.message);
        return;
      }
      // Mirror pe profiles (best-effort).
      if (profile?.id) {
        await supabase.from('profiles').update({ email: next }).eq('id', profile.id);
      }
      setAuthEmail(next);
      setMessage(
        'Ți-am trimis un link de confirmare pe noul email. Până confirmi, rămâne emailul vechi la autentificare.'
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut actualiza emailul.');
    } finally {
      setCredBusy(false);
    }
  }

  async function handleUpdatePassword() {
    if (newPassword.length < 8) {
      setError('Parola nouă trebuie să aibă cel puțin 8 caractere.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Parolele nu coincid.');
      return;
    }
    setCredBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { error: updErr } = await updatePassword(newPassword);
      if (updErr) {
        setError(mapAuthError(updErr) ?? updErr.message);
        return;
      }
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Parola a fost actualizată.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nu am putut actualiza parola.');
    } finally {
      setCredBusy(false);
    }
  }

  useEffect(() => {
    if (profile && !diag && !diagBusy) {
      void handleRefreshDiagnostics(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  if (loading) {
    return (
      <View style={{ flex: 1 }}>
        <SkeletonScreen
          title="Setări"
          subtitle={getAppVersionLabel()}
          onBack={back}
          blocks={5}
          label="Se încarcă profilul…"
        />
      </View>
    );
  }

  if (appMode === 'business' && !inBusinessTabs) {
    return <Redirect href="/(app)/business/(tabs)/settings" />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen
      title="Setări"
      subtitle={getAppVersionLabel()}
      onBack={back}
      bottomInset={!inBusinessTabs && appMode === 'client' ? spacing['3xl'] + 56 : undefined}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Callout tone="danger" title="A apărut o eroare">
              {error}
            </Callout>
          ) : null}
          {message ? (
            <Callout tone="success" title="Gata">
              {message}
            </Callout>
          ) : null}
          <Button
            label={saving ? 'Se salvează…' : 'Salvează profilul'}
            icon="checkmark"
            loading={saving}
            onPress={handleSave}
          />
        </View>
      }
    >
      <View
        style={[
          styles.profilePanel,
          { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          t.shadows.sm,
        ]}
      >
        <View style={styles.profileHead}>
          <Pressable
            onPress={openAvatarPicker}
            disabled={avatarBusy}
            accessibilityRole="button"
            accessibilityLabel="Schimbă poza de profil"
            hitSlop={8}
            style={[styles.profileAvatarWrap, avatarBusy && { opacity: 0.6 }]}
          >
            <View
              style={[
                styles.profileAvatar,
                {
                  backgroundColor: avatarUrl ? 'transparent' : t.colors.surfaceMuted,
                  borderColor: t.colors.border,
                },
              ]}
            >
              {avatarUrl ? (
                <Image
                  key={avatarUrl}
                  source={{ uri: avatarUrl }}
                  style={styles.profileAvatarImg}
                  resizeMode="cover"
                  accessibilityLabel="Poza de profil"
                />
              ) : (
                <Ionicons name="person-outline" size={26} color={t.colors.textMuted} />
              )}
            </View>
            <View
              pointerEvents="none"
              style={[
                styles.profileAvatarBadge,
                {
                  backgroundColor: t.colors.accent,
                  borderColor: t.colors.surface,
                },
              ]}
            >
              <Ionicons
                name={avatarBusy ? 'hourglass-outline' : 'camera-outline'}
                size={11}
                color={t.colors.onAccent}
              />
            </View>
          </Pressable>
          <View style={styles.profileId}>
            <Text style={[styles.profileName, { color: t.colors.text }]} numberOfLines={1}>
              {displayName.trim() || profile?.display_name || 'Cont'}
            </Text>
            <Text style={[styles.profileEmail, { color: t.colors.textMuted }]} numberOfLines={1}>
              {profile?.email || authEmail || 'Fără email'}
            </Text>
            <Text style={[styles.profilePhone, { color: t.colors.text }]} numberOfLines={1}>
              {phoneInput.trim()
                ? phoneInput.trim()
                : profile?.phone
                  ? formatPhoneDisplay(profile.phone)
                  : 'Fără telefon'}
            </Text>
          </View>
        </View>

        
        {appMode === 'business' ? (
          <View style={styles.logoRow}>
            <Pressable
              onPress={openLogoPicker}
              disabled={logoBusy || !businessId}
              accessibilityRole="button"
              accessibilityLabel="Schimbă logo firmă"
              style={[styles.logoWrap, logoBusy && { opacity: 0.6 }]}
            >
              <View
                style={[
                  styles.logoBox,
                  {
                    backgroundColor: logoUrl ? 'transparent' : t.colors.surfaceMuted,
                    borderColor: t.colors.border,
                  },
                ]}
              >
                {logoUrl ? (
                  <Image
                    key={logoUrl}
                    source={{ uri: logoUrl }}
                    style={styles.logoImg}
                    resizeMode="cover"
                    accessibilityLabel="Logo firmă"
                  />
                ) : (
                  <Ionicons name="storefront-outline" size={26} color={t.colors.textMuted} />
                )}
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.profileAvatarBadge,
                  { backgroundColor: t.colors.accent, borderColor: t.colors.surface },
                ]}
              >
                <Ionicons
                  name={logoBusy ? 'hourglass-outline' : 'camera-outline'}
                  size={11}
                  color={t.colors.onAccent}
                />
              </View>
            </Pressable>
            <View style={styles.logoCopy}>
              <Text style={[styles.logoTitle, { color: t.colors.text }]}>Logo firmă</Text>
              <Text style={[styles.logoHint, { color: t.colors.textMuted }]}>
                {businessId
                  ? 'Separat de poza ta de profil. Apare pe Home business.'
                  : 'Configurează business-ul ca să poți adăuga logo-ul.'}
              </Text>
            </View>
          </View>
        ) : null}

        {appMode === 'business' ? (
          <View style={styles.logoRow}>
            <Pressable
              onPress={openVideoPicker}
              disabled={videoBusy || !businessId}
              accessibilityRole="button"
              accessibilityLabel="Video de prezentare"
              style={[styles.logoWrap, videoBusy && { opacity: 0.6 }]}
            >
              <View
                style={[
                  styles.logoBox,
                  {
                    backgroundColor: t.colors.surfaceMuted,
                    borderColor: t.colors.border,
                  },
                ]}
              >
                <Ionicons name="videocam-outline" size={26} color={t.colors.textMuted} />
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.profileAvatarBadge,
                  { backgroundColor: t.colors.accent, borderColor: t.colors.surface },
                ]}
              >
                <Ionicons
                  name={videoBusy ? 'hourglass-outline' : 'videocam-outline'}
                  size={11}
                  color={t.colors.onAccent}
                />
              </View>
            </Pressable>
            <View style={styles.logoCopy}>
              <Text style={[styles.logoTitle, { color: t.colors.text }]}>Video prezentare</Text>
              <Text style={[styles.logoHint, { color: t.colors.textMuted }]}>
                {businessId
                  ? 'Maxim 90 secunde, 50 MB (MP4/MOV/WebM). Clienții îl văd la căutare.'
                  : 'Configurează business-ul ca să poți adăuga video-ul.'}
              </Text>
            </View>
          </View>
        ) : null}
        {appMode === 'business' && videoUrl && businessId ? (
          <PromoVideo videoUrl={videoUrl} title="Prezentarea business-ului tău" />
        ) : null}

<Field
          label={appMode === 'business' ? 'Telefon business (opțional)' : 'Telefon'}
          value={phoneInput}
          onChangeText={setPhoneInput}
          placeholder="07xxxxxxxx"
          keyboardType="phone-pad"
          autoComplete="tel"
          icon="call-outline"
          hint={
            appMode === 'business'
              ? 'Apare pe cartea de vizită ca să te poată suna clienții. Opțional dacă ai deja email pe cont — Salvează profilul ca să rămână.'
              : 'Sub email, pe profil. Apasă „Salvează profilul” — Home nu mai șterge numărul.'
          }
        />
        <Field
          label="Nume afișat"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Numele tău"
          icon="person-outline"
          autoCapitalize="words"
        />
      </View>

      <SectionTitle>Aspect</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          Temă Programări Aurora (teal + sky, ca iconul). Alege: ca pe telefon, deschisă sau închisă.
        </Text>
        <Segmented
          value={themePref}
          onChange={(next) => {
            setThemePref(next);
            void setThemePreference(next);
          }}
          options={[
            { value: 'system', label: 'Sistem' },
            { value: 'light', label: 'Deschisă' },
            { value: 'dark', label: 'Închisă' },
          ]}
        />
        <Text style={[styles.panelText, { color: t.colors.textFaint }]}>
          {themePref === 'system'
            ? 'Urmează tema dispozitivului (light / dark).'
            : themePref === 'light'
              ? 'Tema deschisă e forțată, indiferent de telefon.'
              : 'Tema închisă e forțată, indiferent de telefon.'}
        </Text>
      </View>

      <SectionTitle>WhatsApp</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {profile?.phone || (phoneInput.trim() && normalizePhoneE164(phoneInput.trim())) ? (
          <>
            <SettingRow
              icon="logo-whatsapp"
              title="Folosește WhatsApp pe acest număr"
              description={
                whatsappEnabled
                  ? 'WhatsApp e legat de telefonul de mai sus (confirmări și reminder-uri).'
                  : 'Oprit — telefonul rămâne doar contact, fără mesaje WhatsApp.'
              }
              right={
                <Toggle
                  value={whatsappEnabled}
                  onValueChange={(next) => {
                    setWhatsappEnabled(next);
                    void AsyncStorage.setItem('settings.whatsappEnabled', next ? '1' : '0');
                    // Sync DB (v31); ignoră dacă coloana lipsește încă.
                    if (profile?.id) {
                      void supabase
                        .from('profiles')
                        .update({ notify_whatsapp: next })
                        .eq('id', profile.id)
                        .then(({ error: waErr }) => {
                          if (waErr && !/notify_whatsapp/i.test(waErr.message)) {
                            console.warn('notify_whatsapp sync', waErr.message);
                          }
                        });
                    }
                  }}
                  accessibilityLabel="Folosește WhatsApp pe acest număr"
                />
              }
            />
            {whatsappEnabled ? (
              <>
                <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
                  Trimite un mesaj test pe {formatPhoneDisplay(
                    normalizePhoneE164(phoneInput.trim()) ?? profile?.phone ?? null
                  )}. Necesită Meta sau Twilio pe server.
                </Text>
                <Button
                  label={waBusy ? 'Se trimite…' : 'Trimite mesaj test'}
                  variant="success"
                  size="md"
                  icon="logo-whatsapp"
                  loading={waBusy}
                  disabled={waBusy}
                  onPress={handleTestWhatsApp}
                />
              </>
            ) : (
              <Text style={[styles.panelText, { color: t.colors.textFaint }]}>
                Activează caseta ca să trimiți pe WhatsApp.
              </Text>
            )}
          </>
        ) : (
          <View style={styles.waEmpty}>
            <View style={[styles.waLogo, { backgroundColor: t.colors.successSoft }]}>
              <Ionicons name="logo-whatsapp" size={36} color={t.colors.success} />
            </View>
            <Text style={[styles.panelText, { color: t.colors.text, fontWeight: '700' }]}>
              WhatsApp nelegat
            </Text>
            <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
              Adaugă numărul la „Telefon” mai sus și apasă „Salvează profilul”. Apoi
              activează caseta WhatsApp ca să trimiți confirmări pe acel număr.
            </Text>
          </View>
        )}
      </View>

      <SectionTitle>Notificări pe care le primești</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {appMode === 'business' ? (
          <Callout tone="info" title="Cereri noi">
            Popup-ul pentru cereri noi vine din Notificări push (mai jos) — nu din aceste casete. Casetele se aplică doar dacă tu ești client la alt business.
          </Callout>
        ) : null}
        <SettingRow
          icon="alarm-outline"
          title={
            appMode === 'business'
              ? 'Reminder (când ești client)'
              : 'Reminder înainte de programare'
          }
          description={
            appMode === 'business'
              ? notifyReminders
                ? 'Dacă tu rezervi la alt business, primești reminder cu 24h / 1h înainte.'
                : 'Oprit pentru programările tale ca client.'
              : notifyReminders
                ? 'Primești email/WhatsApp cu 24 de ore și cu 1 oră înainte.'
                : 'Nu primești reminder înainte de programare.'
          }
          right={
            <Toggle
              value={notifyReminders}
              onValueChange={setNotifyReminders}
              accessibilityLabel="Reminder înainte de programare"
            />
          }
        />
        <SettingRow
          icon="checkmark-circle-outline"
          title={
            appMode === 'business'
              ? 'Decizie (când ești client)'
              : 'Confirmare sau respingere'
          }
          description={
            appMode === 'business'
              ? notifyDecision
                ? 'Mesaj când un alt business îți aprobă sau respinge cererea.'
                : 'Oprit — nu primești mesaj la decizia altui business.'
              : notifyDecision
                ? 'Primești mesaj când business-ul aprobă sau respinge cererea ta.'
                : 'Nu primești mesaj la aprobare sau respingere.'
          }
          right={
            <Toggle
              value={notifyDecision}
              onValueChange={setNotifyDecision}
              accessibilityLabel="Confirmare sau respingere"
            />
          }
        />
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          {appMode === 'business'
            ? 'Salvează profilul pentru casetele de mai sus. Cererea nouă pe salonul tău se anunță prin push, independent de aceste opțiuni.'
            : 'Salvează profilul pentru a aplica schimbările. WhatsApp folosește caseta din secțiunea WhatsApp și numărul de la Telefon.'}
        </Text>
      </View>

      <SectionTitle>Notificări push</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {Constants.appOwnership === 'expo' ? (
          <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
            Rulezi în Expo Go: notificările cu aplicația închisă nu funcționează aici
            (limită Expo Go, nu e o eroare). Primești vibrație + banner în app când vine
            o cerere nouă, cât timp app-ul e deschis. Pentru popup cu app-ul închis ai
            nevoie de build-ul nativ (APK pe Android / TestFlight pe iPhone).
          </Text>
        ) : null}
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          Ca popup-ul să vină și cu aplicația închisă complet, toate trebuie să fie ✅:
          permisiunea sistem, canalul popup, token înregistrat în baza de date și build
          APK cu Firebase (actualizarea OTA nu aduce Firebase).
        </Text>
        <Button
          label={pushBusy ? 'Se înregistrează…' : 'Activează / reînregistrează notificările'}
          variant="secondary"
          size="md"
          icon="notifications-outline"
          loading={pushBusy}
          disabled={pushBusy || pushTestBusy || !profile}
          onPress={handleReregisterPush}
        />
        {Platform.OS === 'android' ? (
          <Button
            label="Deschide setări Pop on screen"
            variant="ghost"
            size="md"
            icon="settings-outline"
            disabled={pushBusy || pushTestBusy}
            onPress={handleOpenPopOnScreenSettings}
          />
        ) : null}
        <Button
          label={pushTestBusy ? 'Se trimite test…' : 'Test popup (minimalizează în 5s)'}
          variant="ghost"
          size="md"
          icon="phone-portrait-outline"
          loading={pushTestBusy}
          disabled={pushBusy || pushTestBusy}
          onPress={handleStatusBarTest}
        />
        <SettingRow
          icon={pushDiagOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
          title={pushDiagOpen ? 'Ascunde diagnostic push' : 'Arată diagnostic push'}
          description="Detalii tehnice (permisiune, canal, token) — de obicei nu ai nevoie."
          onPress={() => setPushDiagOpen((v) => !v)}
        />
        {pushDiagOpen ? (
          <>
            {diag ? (
              <View style={{ gap: 6 }}>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {diag.permission === 'granted' ? '✅' : '❌'} Permisiune notificări: {diag.permission}
                </Text>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {diag.channelOk ? '✅' : '❌'} Canal popup (Pop on screen):{' '}
                  {diag.channelOk ? 'OK' : 'lipsește / importance mică'}
                </Text>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {(diag.tokensInDb ?? 0) > 0 ? '✅' : '❌'} Token înregistrat în DB:{' '}
                  {diag.tokensInDb == null ? 'necunoscut' : diag.tokensInDb}
                </Text>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {diag.projectIdPresent ? '✅' : '❌'} Config EAS projectId:{' '}
                  {diag.projectIdPresent ? 'OK' : 'lipsește — reinstalează din ultimul build'}
                </Text>
                {diag.isDevice === false ? (
                  <Text style={[styles.panelText, { color: t.colors.text }]}>
                    ❌ Rulezi pe simulator — push-ul merge doar pe telefon fizic.
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Button
              label={diagBusy ? 'Se verifică…' : 'Verifică status push'}
              variant="ghost"
              size="md"
              icon="checkmark-circle-outline"
              loading={diagBusy}
              disabled={diagBusy || pushBusy || pushTestBusy || !profile}
              onPress={() => void handleRefreshDiagnostics()}
            />
            <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
              {Platform.OS === 'ios'
                ? 'Pe iPhone nu există „Pop on screen” — notificarea vine ca banner în partea de sus dacă ai permisiunile acordate (inclusiv „Time Sensitive”, dacă ți se cere). Dacă testul local apare dar cererile noi nu, lipsește cheia APNs în EAS sau build-ul e prea vechi.'
                : 'Cont business: cererea apare în app din baza de date; popup-ul pe ecran („Pop on screen”) e setare Android pe canalul de notificări — pe multe telefoane e oprit implicit.'}
              {'\n\n'}
              {Platform.OS === 'ios'
                ? 'Pași: 1) Activează notificările 2) „Test popup” și blochează ecranul imediat (5s) 3) Dacă testul local apare dar cererile noi nu, verifică cheia APNs în EAS și webhook-ul Supabase.'
                : 'Pași: 1) Activează notificările 2) „Deschide setări Pop on screen” → activează Pe ecran / Urgent 3) „Test popup” și minimalizează app-ul imediat (5s). Dacă testul local apare pe ecran dar cererile noi nu, verifică webhook-ul Supabase (notify-pending-push la INSERT pe appointments) și cheia FCM V1 pe EAS.'}
            </Text>
          </>
        ) : null}
      </View>

      <SectionTitle>Tip cont</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {appMode === 'business' ? (
          <Badge tone="accent" icon="storefront-outline">
            Cont business
          </Badge>
        ) : appMode === 'client' ? (
          <Badge tone="info" icon="person-outline">
            Cont client
          </Badge>
        ) : (
          <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
            Tipul de cont se încarcă…
          </Text>
        )}
      </View>

      {appMode === 'business' ? (
        <>
          <SectionTitle>Business</SectionTitle>
          {!businessId ? (
            <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
              <Callout tone="warning" title="Business neconfigurat">
                Completează numele, programul și locația ca să poți primi cereri și să afișezi QR-ul.
              </Callout>
              <Button
                label="Configurează business-ul"
                icon="construct-outline"
                onPress={() => router.push('/(app)/business/setup' as never)}
              />
            </View>
          ) : (
            <>
              <SettingRow
                icon="construct-outline"
                title="Configurare"
                description={bizName ? `Editează ${bizName}` : 'Program, locație, reguli'}
                onPress={() => router.push('/(app)/business/setup' as never)}
              />
              <SettingRow
                icon="qr-code-outline"
                title="Cod QR"
                description={bizPublicCode ? `Cod public ${bizPublicCode}` : 'Partajează linkul de programare'}
                onPress={() => router.push('/(app)/business/qr' as never)}
              />
              <SettingRow
                icon="cut-outline"
                title="Servicii"
                description={hasServices ? 'Gestionează oferta' : 'Adaugă primul serviciu'}
                onPress={() => router.push('/(app)/business/services' as never)}
              />
              <SettingRow
                icon="people-outline"
                title="Echipă"
                description={hasStaff ? 'Specialiști și program' : 'Adaugă specialiști'}
                onPress={() => router.push('/(app)/business/staff' as never)}
              />

              <SectionTitle>Checklist carte de vizită</SectionTitle>
              <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
                {(() => {
                  const missing = missingVisitCardFields({
                    name: bizName,
                    phone: profile?.phone ?? (phoneInput.trim() ? phoneInput.trim() : null),
                    hasAddress: bizHasAddress,
                    hasCoords: bizHasCoords,
                    publicCode: bizPublicCode,
                  });
                  const extras: string[] = [];
                  if (!logoUrl) extras.push('logo firmă');
                  if (!videoUrl) extras.push('video prezentare (opțional)');
                  if (!hasServices) extras.push('cel puțin un serviciu activ');
                  if (!hasStaff) extras.push('cel puțin un specialist activ');
                  const allMissing = [...missing, ...extras.filter((e) => e !== 'video prezentare (opțional)')];
                  if (allMissing.length === 0) {
                    return (
                      <Text style={[styles.panelText, { color: t.colors.success }]}>
                        ✅ Cartea de vizită e completă. Clienții te găsesc cu telefon, adresă și QR.
                      </Text>
                    );
                  }
                  return (
                    <>
                      <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
                        Mai lipsește: {allMissing.join(', ')}.
                      </Text>
                      {!missing.includes('numărul de telefon (Setări)') ? null : (
                        <Text style={[styles.panelText, { color: t.colors.textFaint }]}>
                          Telefonul e opțional pe cont, dar fără el clienții nu te pot suna din cartea de vizită.
                        </Text>
                      )}
                    </>
                  );
                })()}
              </View>
            </>
          )}
        </>
      ) : null}

      <SectionTitle>Email și parolă</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Field
          label="Email"
          value={emailInput}
          onChangeText={setEmailInput}
          placeholder="email@exemplu.ro"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          icon="mail-outline"
          hint="Schimbarea emailului cere confirmare pe adresa nouă."
        />
        <Button
          label={credBusy ? 'Se actualizează…' : 'Actualizează emailul'}
          variant="secondary"
          size="md"
          icon="mail-outline"
          loading={credBusy}
          disabled={credBusy || saving}
          onPress={() => void handleUpdateEmail()}
        />
        <Field
          label="Parolă nouă"
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Minim 8 caractere"
          secureTextEntry
          icon="lock-closed-outline"
          autoCapitalize="none"
        />
        <Field
          label="Confirmă parola"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Rescrie parola"
          secureTextEntry
          icon="lock-closed-outline"
          autoCapitalize="none"
        />
        <Button
          label={credBusy ? 'Se actualizează…' : 'Schimbă parola'}
          variant="secondary"
          size="md"
          icon="key-outline"
          loading={credBusy}
          disabled={credBusy || saving || !newPassword}
          onPress={() => void handleUpdatePassword()}
        />
      </View>

      <SectionTitle>Cont</SectionTitle>
      {!inBusinessTabs && appMode === 'client' ? (
        <SettingRow
          icon="chatbubbles-outline"
          title="Mesaje"
          description="Chat cu business-urile tale"
          onPress={() => router.push('/(app)/chat' as never)}
        />
      ) : null}
      <SettingRow
        icon="log-out-outline"
        title="Deconectare"
        description="Te poți întoarce oricând cu aceleași date de autentificare."
        onPress={handleLogout}
        danger
      />

      <Text
        style={[styles.versionFooter, { color: t.colors.textFaint }]}
        accessibilityLabel={`Versiune ${getAppVersionLabel()}`}
      >
        {getAppVersionLabel()}
      </Text>
    </Screen>
      {!inBusinessTabs && appMode === 'client' ? <ClientTabBar /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.md },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  panelText: { fontSize: fontSize.sm, lineHeight: 19 },

  waEmpty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  waLogo: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  profilePanel: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  profileHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileAvatarWrap: {
    width: 52,
    height: 52,
    position: 'relative',
    zIndex: 2,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 1,
  },
  profileAvatarImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 52,
    height: 52,
    borderRadius: radius.md,
  },
  profileAvatarBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    zIndex: 3,
    elevation: 3,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logoWrap: {
    width: 52,
    height: 52,
    position: 'relative',
  },
  logoBox: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  logoImg: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 52,
    height: 52,
    borderRadius: radius.md,
  },
  logoCopy: { flex: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  logoTitle: { fontSize: fontSize.md, fontWeight: '700' },
  logoHint: { fontSize: fontSize.sm, flexShrink: 1, lineHeight: 18 },
  profileId: { flex: 1, flexShrink: 1, gap: 2, minWidth: 0 },
  profileName: { fontSize: fontSize.lg, fontWeight: '800' },
  profileEmail: { fontSize: fontSize.sm, flexShrink: 1 },
  profilePhone: { fontSize: fontSize.md, fontWeight: '700', flexShrink: 1 },
  versionFooter: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
