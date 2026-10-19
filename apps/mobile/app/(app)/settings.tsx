import { useCallback, useEffect, useState } from 'react';
import { Alert, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect, useSegments } from 'expo-router';

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
import { deleteMyAccount, exportMyData } from '@/lib/accountData';
import { mapAuthError, signOut, updatePassword } from '@/lib/auth';
import { getAppVersionLabel } from '@/lib/appVersion';
import { parseAccountKind } from '@/lib/accountKind';
import { getAppMode, type AppMode } from '@/lib/appMode';
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '@/lib/themePreference';
import { trKey, useLanguage, useT } from '@/lib/i18n';
import { getLanguageSync, setLanguage } from '@/lib/language';
import { confirmAction } from '@/lib/confirm';
import { getPublicWebOrigin } from '@/lib/webBase';
import { FlagRO, FlagUS } from '@/components/LanguageFlag';
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
import { scheduleMessageDismiss } from '@/lib/transientMessage';
import { isGoogleConnected } from '@/lib/googleCalendar';
import { getSelectedBusinessId } from '@/lib/myBusiness';
import {
  serviceChecklistState,
  type ServiceChecklistState,
} from '@/lib/serviceChecklist';
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
  const tr = useT();
  const { lang } = useLanguage();
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
  const [serviceState, setServiceState] = useState<ServiceChecklistState>({ kind: 'none' });
  const [gcalStatus, setGcalStatus] = useState<{
    google_calendar_id: string | null;
    connected_at: string | null;
    last_synced_at: string | null;
  } | null>(null);
  const [gcalBusy, setGcalBusy] = useState(false);
  const [hasStaff, setHasStaff] = useState(false);
  const [pushDiagOpen, setPushDiagOpen] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [credBusy, setCredBusy] = useState(false);
  const [themePref, setThemePref] = useState<ThemePreference>('system');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Bannerul de succes e temporar: dispare singur, nu rămâne pe pagină.
  useEffect(() => {
    if (!message) return;
    return scheduleMessageDismiss(() => setMessage(null));
  }, [message]);

  useEffect(() => {
    void getThemePreference().then(setThemePref);
  }, []);

  const loadGcalStatus = useCallback(async () => {
    if (!businessId) {
      setGcalStatus(null);
      return;
    }
    const { data, error: statusErr } = await supabase.rpc('get_google_calendar_status', {
      p_business_id: businessId,
    });
    if (statusErr) {
      setError(trKey('gcal.statusFail'));
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    setGcalStatus(row ?? null);
  }, [businessId]);

  // Se incarca la focus (inclusiv prima afisare si dupa intoarcerea din OAuth).
  useFocusEffect(
    useCallback(() => {
      void loadGcalStatus();
    }, [loadGcalStatus])
  );

  async function handleGoogleConnect() {
    if (!businessId) return;
    setGcalBusy(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke('google-calendar-connect', {
      body: { business_id: businessId },
    });
    setGcalBusy(false);
    const payload = data as { url?: string; error?: string } | null;
    if (err || !payload?.url) {
      setError(
        payload?.error === 'google_not_configured'
          ? trKey('gcal.notConfigured')
          : trKey('gcal.syncFail')
      );
      return;
    }
    await Linking.openURL(payload.url);
  }

  async function handleGoogleSync() {
    if (!businessId) return;
    setGcalBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: err } = await supabase.functions.invoke('google-calendar-sync', {
      body: { business_id: businessId },
    });
    setGcalBusy(false);
    const payload = data as {
      ok?: boolean;
      imported?: number;
      pushed?: number;
      pushFailed?: number;
      updateFailed?: number;
      removeFailed?: number;
      errors?: string[];
    } | null;
    if (err || !payload) {
      setError(trKey('gcal.syncFail'));
      return;
    }
    const failedCount =
      (payload.pushFailed ?? 0) + (payload.updateFailed ?? 0) + (payload.removeFailed ?? 0);
    if (payload.ok === false) {
      setError(
        trKey('gcal.syncPartial', {
          failed: failedCount + (payload.errors?.length ?? 0),
        })
      );
      return;
    }
    setMessage(
      trKey('gcal.syncOk', {
        imported: payload.imported ?? 0,
        pushed: payload.pushed ?? 0,
      })
    );
    const { data: status } = await supabase.rpc('get_google_calendar_status', {
      p_business_id: businessId,
    });
    setGcalStatus((Array.isArray(status) ? status[0] : status) ?? null);
  }

  async function handleGoogleDisconnect() {
    if (!businessId) return;
    setGcalBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('disconnect_google_calendar', {
      p_business_id: businessId,
    });
    setGcalBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setGcalStatus(null);
    setMessage(trKey('gcal.disconnected'));
  }

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
          .order('created_at', { ascending: true });
        if (!full.error) {
          const rows = (full.data ?? []) as BizRow[];
          const selectedId = await getSelectedBusinessId();
          biz = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
        } else if (/promo_video_url/i.test(full.error.message)) {
          const base = await supabase
            .from('business_profiles')
            .select('id, name, public_code, logo_url, county, city, address, latitude, longitude')
            .eq('owner_user_id', user.id)
            .order('created_at', { ascending: true });
          const baseRows = (base.data ?? []) as BizRow[];
          const baseSelectedId = await getSelectedBusinessId();
          biz = baseRows.find((r) => r.id === baseSelectedId) ?? baseRows[0] ?? null;
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
        const [{ data: svcRows }, { count: staffCount }] = await Promise.all([
          supabase
            .from('services')
            .select('name, active')
            .eq('business_id', biz.id)
            .order('sort_order', { ascending: true }),
          supabase
            .from('staff')
            .select('id', { count: 'exact', head: true })
            .eq('business_id', biz.id)
            .eq('active', true),
        ]);
        const svcState = serviceChecklistState(
          (svcRows ?? []) as { name: string; active: boolean }[],
        );
        setServiceState(svcState);
        setHasServices(svcState.kind === 'ok');
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
        setServiceState({ kind: 'none' });
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
    if (!user) throw new Error(trKey('req.notAuthed'));
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
      setError(trKey('req.notAuthed'));
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
      setMessage(trKey('set.avatarUp'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('team.photoFail'));
      // Dacă uploadul eșuează, revenim la URL-ul salvat (dacă există).
      setAvatarUrl(profile?.avatar_url ?? null);
    }
    setAvatarBusy(false);
  }

  async function pickAvatarFromGallery(): Promise<void> {
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
      setError(trKey('set.avatarCamera'));
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
      setMessage(trKey('set.avatarDel'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.avatarDelFail'));
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
    if (!businessId) throw new Error(trKey('set.setupFirstParen', { setup: trKey('setup.title') }));
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
      setError(trKey('set.logoNeedSetup'));
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
      setMessage(trKey('set.logoUp'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.logoFail'));
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
      setError(trKey('set.logoCamera'));
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
      setMessage(trKey('set.logoDel'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.logoDelFail'));
    }
    setLogoBusy(false);
  }

  function openLogoPicker(): void {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      { text: tr('team.fromGallery'), onPress: () => void pickLogoFromGallery() },
      { text: tr('set.openCamera'), onPress: () => void takeLogoPhoto() },
    ];
    if (logoUrl) {
      buttons.push({
        text: tr('set.delLogo'),
        style: 'destructive',
        onPress: () => void clearLogo(),
      });
    }
    buttons.push({ text: tr('common.cancel'), style: 'cancel' });
    Alert.alert(tr('set.logoTitle'), tr('set.logoAlertBody'), buttons);
  }

  async function persistVideoUrl(url: string | null): Promise<void> {
    if (!businessId) throw new Error(trKey('set.setupFirstParen', { setup: trKey('setup.title') }));
    const { error } = await supabase
      .from('business_profiles')
      .update({ promo_video_url: url })
      .eq('id', businessId);
    if (error) {
      if (/promo_video_url|business-videos|bucket/i.test(error.message)) {
        throw new Error(trKey('set.videoMigration'));
      }
      throw error;
    }
    setVideoUrl(url);
  }

  async function handleVideoResult(result: ImagePicker.ImagePickerResult): Promise<void> {
    if (result.canceled || result.assets.length === 0) return;
    if (!businessId) {
      setError(trKey('set.videoNeedSetup'));
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
      setMessage(trKey('set.videoSaved'));
    } catch (e) {
      const raw = e instanceof Error ? e.message : trKey('set.videoFail');
      setError(
        /bucket|storage/i.test(raw)
          ? trKey('set.videoMigration')
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
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
        videoMaxDuration: 90,
      });
      await handleVideoResult(result);
    } catch {
      setError(trKey('set.galleryFail'));
    }
  }

  async function recordVideo(): Promise<void> {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError(trKey('set.videoCamera'));
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
      setError(trKey('set.cameraFail'));
    }
  }

  async function clearVideo(): Promise<void> {
    setVideoBusy(true);
    setError(null);
    try {
      await persistVideoUrl(null);
      setMessage(trKey('set.videoDel'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.videoDelFail'));
    }
    setVideoBusy(false);
  }

  function openVideoPicker(): void {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      { text: tr('team.fromGallery'), onPress: () => void pickVideoFromGallery() },
      { text: tr('set.recordNow'), onPress: () => void recordVideo() },
    ];
    if (videoUrl) {
      buttons.push({
        text: tr('set.delVideo'),
        style: 'destructive',
        onPress: () => void clearVideo(),
      });
    }
    buttons.push({ text: tr('common.cancel'), style: 'cancel' });
    Alert.alert(tr('set.videoTitle'), tr('set.videoAlertBody'), buttons);
  }

  function openAvatarPicker(): void {
    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      {
        text: tr('team.fromGallery'),
        onPress: () => void pickAvatarFromGallery(),
      },
      {
        text: tr('set.openCamera'),
        onPress: () => void takeAvatarPhoto(),
      },
    ];
    if (avatarUrl) {
      buttons.push({
        text: tr('team.delPhoto'),
        style: 'destructive',
        onPress: () => void clearAvatar(),
      });
    }
    buttons.push({ text: tr('common.cancel'), style: 'cancel' });
    Alert.alert(tr('set.avatarTitle'), tr('set.avatarAlertBody'), buttons);
  }

  async function handleSave(): Promise<boolean> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError(trKey('req.notAuthed'));
      return false;
    }

    let normalized: string | null = null;
    if (phoneInput.trim()) {
      normalized = normalizePhoneE164(phoneInput.trim());
      if (!normalized) {
        setError(trKey('set.badPhone'));
        return false;
      }
      if (!isValidRoMobile(normalized)) {
        setError(trKey('set.badRoPhone'));
        return false;
      }
    }

    const email = profile?.email ?? user.email ?? null;
    if (!email && !normalized) {
      setError(trKey('set.needContact'));
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
      if (!uid) return { data: null, error: trKey('req.notAuthed') };
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
      else if (!verify) errMsg = trKey('set.profileMissing');
      else if ((verify.phone ?? null) !== (normalized ?? null)) {
        errMsg = trKey('set.phoneNotPersisted', {
          wrote: normalized ?? trKey('set.unknown'),
          read: verify.phone ?? trKey('set.unknown'),
        });
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
      setError(trKey('set.saveNoProfile'));
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
        ? trKey('set.phoneSaved', {
            phone: formatPhoneDisplay(saved.phone),
            home: trKey('tabs.home'),
          })
        : trKey('set.profileNoPhone')
    );
    return true;
  }

  async function handleTestWhatsApp() {
    if (!whatsappEnabled) {
      setError(trKey('set.waEnableFirst'));
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
      setError(trKey('set.waNeedPhone'));
      return;
    }

    try {
      const result = await invokeTestWhatsApp();
      if (!result.ok) {
        setError(result.error ?? trKey('set.waTestFail'));
        return;
      }
      if (result.data?.result?.stub) {
        setError(result.data.hint ?? trKey('set.waStub'));
        return;
      }
      setMessage(
        trKey('set.waSent', {
          phone: formatPhoneDisplay(result.data?.phone ?? normalized),
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.waErr'));
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
            trKey('set.pushReReg', {
              secs: local.delaySec ?? 5,
              pop: trKey('set.pushPopSettings'),
            })
          );
        } else if (local.reason === 'channel_importance_low') {
          setMessage(trKey('set.pushLowChannel'));
          await openBookingChannelSettings();
          setError(trKey('set.pushAndroidChannel'));
        } else {
          setMessage(
            trKey('set.pushLocalFail', {
              reason: local.reason ?? trKey('set.unknown'),
            })
          );
        }
      } else if (result.reason === 'simulator') {
        setError(trKey('set.pushSim'));
      } else if (result.reason === 'permission_denied') {
        setError(trKey('set.pushPermDenied'));
      } else if (result.reason === 'web_unsupported') {
        setError(trKey('set.pushWeb'));
      } else if (result.reason === 'expo_go_no_remote_push') {
        setError(trKey('set.pushExpoGoRemote'));
      } else if (result.reason === 'push_unavailable') {
        setError(trKey('set.pushExpoGo'));
      } else if (result.reason === 'missing_project_id') {
        setError(trKey('set.pushEas'));
      } else if (
        result.reason?.toLowerCase().includes('google') ||
        result.reason?.toLowerCase().includes('firebase') ||
        result.reason?.toLowerCase().includes('fcm') ||
        result.reason?.toLowerCase().includes('google-services')
      ) {
        setError(result.reason);
      } else {
        setError(result.reason ?? trKey('set.pushTokenFail'));
      }
      void handleRefreshDiagnostics(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.pushRegErr'));
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
        setMessage(trKey('set.testScheduled', { secs: local.delaySec ?? 5 }));
      } else if (local.reason === 'permission_denied') {
        setError(trKey('set.pushPermDenied'));
      } else if (local.reason === 'channel_importance_low') {
        await openBookingChannelSettings();
        setError(trKey('set.channelLow'));
      } else {
        setError(local.reason ?? trKey('set.localTestFail'));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.statusBarErr'));
    } finally {
      setPushTestBusy(false);
    }
  }

  async function handleOpenPopOnScreenSettings() {
    setError(null);
    setMessage(null);
    try {
      await openBookingChannelSettings();
      setMessage(trKey('set.popSteps'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.popFail'));
    }
  }

  async function handleExportData() {
    setError(null);
    const res = await exportMyData();
    if (!res.ok) setError(trKey('set.exportFailed'));
  }

  async function handleDeleteAccount() {
    const ok = await confirmAction({
      title: trKey('set.deleteAccount'),
      message: trKey('set.deleteAccountBody'),
      confirmText: trKey('set.deleteAccountConfirm'),
      cancelText: trKey('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    const res = await deleteMyAccount();
    if (!res.ok) setError(trKey('set.deleteAccountFailed'));
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
            trKey('set.diagMissing', { enable: trKey('set.pushEnable') })
          );
        } else {
          setMessage(trKey('set.diagOk'));
        }
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : trKey('set.diagErr'));
    } finally {
      if (!silent) setDiagBusy(false);
    }
  }


  async function handleUpdateEmail() {
    const next = emailInput.trim();
    if (!next) {
      setError(trKey('set.needEmail'));
      return;
    }
    if (next === (profile?.email ?? authEmail ?? '')) {
      setMessage(trKey('set.emailSame'));
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
      setMessage(trKey('set.emailSent'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.emailFail'));
    } finally {
      setCredBusy(false);
    }
  }

  async function handleUpdatePassword() {
    if (newPassword.length < 8) {
      setError(trKey('set.passShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(trKey('set.passMismatch'));
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
      setMessage(trKey('set.passUp'));
    } catch (e) {
      setError(e instanceof Error ? e.message : trKey('set.passFail'));
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
          title={tr('set.title')}
          subtitle={getAppVersionLabel()}
          onBack={back}
          blocks={5}
          label={tr('set.loading')}
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
      title={tr('set.title')}
      subtitle={getAppVersionLabel()}
      onBack={back}
      bottomInset={!inBusinessTabs && appMode === 'client' ? spacing['3xl'] + 56 : undefined}
      footer={
        <View style={styles.footer}>
          {error ? (
            <Callout tone="danger" title={tr('common.errorTitle')}>
              {error}
            </Callout>
          ) : null}
          {message ? (
            <Callout tone="success" title={tr('common.done')}>
              {message}
            </Callout>
          ) : null}
          <Button
            label={saving ? tr('cli.saving') : tr('set.saveProfile')}
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
            accessibilityLabel={tr('set.changeAvatar')}
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
                  accessibilityLabel={tr('set.avatarPhoto')}
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
              {displayName.trim() || profile?.display_name || tr('set.account')}
            </Text>
            <Text style={[styles.profileEmail, { color: t.colors.textMuted }]} numberOfLines={1}>
              {profile?.email || authEmail || tr('set.noEmail')}
            </Text>
            <Text style={[styles.profilePhone, { color: t.colors.text }]} numberOfLines={1}>
              {phoneInput.trim()
                ? phoneInput.trim()
                : profile?.phone
                  ? formatPhoneDisplay(profile.phone)
                  : tr('set.noPhone')}
            </Text>
          </View>
        </View>

        
        {appMode === 'business' ? (
          <View style={styles.logoRow}>
            <Pressable
              onPress={openLogoPicker}
              disabled={logoBusy || !businessId}
              accessibilityRole="button"
              accessibilityLabel={tr('set.changeLogo')}
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
                    accessibilityLabel={tr('set.logoImg')}
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
              <Text style={[styles.logoTitle, { color: t.colors.text }]}>{tr('set.logoTitle')}</Text>
              <Text style={[styles.logoHint, { color: t.colors.textMuted }]}>
                {businessId ? tr('set.logoHint') : tr('set.setupForLogo')}
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
              accessibilityLabel={tr('set.promoVideo')}
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
              <Text style={[styles.logoTitle, { color: t.colors.text }]}>{tr('set.videoTitle')}</Text>
              <Text style={[styles.logoHint, { color: t.colors.textMuted }]}>
                {businessId ? tr('set.videoHint') : tr('set.setupForVideo')}
              </Text>
            </View>
          </View>
        ) : null}
        {appMode === 'business' && videoUrl && businessId ? (
          <PromoVideo videoUrl={videoUrl} title={tr('set.promoTitle')} />
        ) : null}

<Field
          label={appMode === 'business' ? tr('set.bizPhone') : tr('cal.phone')}
          value={phoneInput}
          onChangeText={setPhoneInput}
          placeholder="07xxxxxxxx"
          keyboardType="phone-pad"
          autoComplete="tel"
          icon="call-outline"
          hint={
            appMode === 'business'
              ? tr('set.bizPhoneHint', { save: tr('set.saveProfile') })
              : tr('set.phoneHint', { save: tr('set.saveProfile') })
          }
        />
        <Field
          label={tr('set.displayName')}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={tr('set.displayNamePh')}
          icon="person-outline"
          autoCapitalize="words"
        />
      </View>

      <SectionTitle>{tr('set.appearance')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          {tr('set.themeHint')}
        </Text>
        <Segmented
          value={themePref}
          onChange={(next) => {
            setThemePref(next);
            void setThemePreference(next);
          }}
          options={[
            { value: 'system', label: tr('set.themeSystem') },
            { value: 'light', label: tr('set.themeLight') },
            { value: 'dark', label: tr('set.themeDark') },
          ]}
        />
        <Text style={[styles.panelText, { color: t.colors.textFaint }]}>
          {themePref === 'system'
            ? tr('set.themeSystemDesc')
            : themePref === 'light'
              ? tr('set.themeLightDesc')
              : tr('set.themeDarkDesc')}
        </Text>
      </View>

      <SectionTitle>{tr('set.language')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Segmented
          value={lang}
          onChange={(next) => {
            void setLanguage(next);
            void (async () => {
              try {
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (user) {
                  await supabase.from('profiles').update({ language: next }).eq('id', user.id);
                }
              } catch {
                // best effort — UI language already applied locally
              }
            })();
          }}
          options={[
            { value: 'ro', label: 'Română', trailing: <FlagRO /> },
            { value: 'en', label: 'English', trailing: <FlagUS /> },
          ]}
        />
        <Text style={[styles.panelText, { color: t.colors.textFaint }]}>
          {tr('set.langHint')}
        </Text>
      </View>

      <SectionTitle>WhatsApp</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {profile?.phone || (phoneInput.trim() && normalizePhoneE164(phoneInput.trim())) ? (
          <>
            <SettingRow
              icon="logo-whatsapp"
              title={tr('set.waUse')}
              description={whatsappEnabled ? tr('set.waOn') : tr('set.waOff')}
              right={
                <Toggle
                  value={whatsappEnabled}
                  onValueChange={(next) => {
                    void (async () => {
                      const prev = whatsappEnabled;
                      setWhatsappEnabled(next);
                      setError(null);
                      try {
                        await AsyncStorage.setItem('settings.whatsappEnabled', next ? '1' : '0');
                      } catch {
                        // Stocarea locala a esuat: revenim la starea anterioara.
                        setWhatsappEnabled(prev);
                        setError(trKey('set.waSyncFail'));
                        return;
                      }
                      // Sync DB (v31); ignoră dacă coloana lipsește încă.
                      if (profile?.id) {
                        const { error: waErr } = await supabase
                          .from('profiles')
                          .update({ notify_whatsapp: next })
                          .eq('id', profile.id);
                        if (waErr && !/notify_whatsapp/i.test(waErr.message)) {
                          setWhatsappEnabled(prev);
                          await AsyncStorage.setItem(
                            'settings.whatsappEnabled',
                            prev ? '1' : '0'
                          ).catch(() => {});
                          setError(trKey('set.waSyncFail'));
                        }
                      }
                    })();
                  }}
                  accessibilityLabel={tr('set.waUse')}
                />
              }
            />
            {whatsappEnabled ? (
              <>
                <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
                  {tr('set.waTest', {
                    phone: formatPhoneDisplay(
                      normalizePhoneE164(phoneInput.trim()) ?? profile?.phone ?? null
                    ),
                  })}
                </Text>
                <Button
                  label={waBusy ? tr('common.sending') : tr('set.waSendTest')}
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
                {tr('set.waEnableBox')}
              </Text>
            )}
          </>
        ) : (
          <View style={styles.waEmpty}>
            <View style={[styles.waLogo, { backgroundColor: t.colors.successSoft }]}>
              <Ionicons name="logo-whatsapp" size={36} color={t.colors.success} />
            </View>
            <Text style={[styles.panelText, { color: t.colors.text, fontWeight: '700' }]}>
              {tr('set.waUnlinked')}
            </Text>
            <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
              {tr('set.waUnlinkedHint', { phone: tr('cal.phone'), save: tr('set.saveProfile') })}
            </Text>
          </View>
        )}
      </View>

      <SectionTitle>{tr('set.notifTitle')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {appMode === 'business' ? (
          <Callout tone="info" title={tr('set.newReq')}>
            {tr('set.newReqHint')}
          </Callout>
        ) : null}
        <SettingRow
          icon="alarm-outline"
          title={appMode === 'business' ? tr('set.remBiz') : tr('set.remClient')}
          description={
            appMode === 'business'
              ? notifyReminders
                ? tr('set.remBizOn')
                : tr('set.remBizOff')
              : notifyReminders
                ? tr('set.remOn')
                : tr('set.remOff')
          }
          right={
            <Toggle
              value={notifyReminders}
              onValueChange={setNotifyReminders}
              accessibilityLabel={tr('set.remClient')}
            />
          }
        />
        <SettingRow
          icon="checkmark-circle-outline"
          title={appMode === 'business' ? tr('set.decBiz') : tr('set.decClient')}
          description={
            appMode === 'business'
              ? notifyDecision
                ? tr('set.decBizOn')
                : tr('set.decBizOff')
              : notifyDecision
                ? tr('set.decOn')
                : tr('set.decOff')
          }
          right={
            <Toggle
              value={notifyDecision}
              onValueChange={setNotifyDecision}
              accessibilityLabel={tr('set.decClient')}
            />
          }
        />
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          {appMode === 'business'
            ? tr('set.notifSaveBiz', { save: tr('set.saveProfile') })
            : tr('set.notifSaveClient', { save: tr('set.saveProfile') })}
        </Text>
      </View>

      <SectionTitle>{tr('set.pushTitle')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {Constants.appOwnership === 'expo' ? (
          <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
            {tr('set.expoGo')}
          </Text>
        ) : null}
        <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
          {tr('set.pushChecklist')}
        </Text>
        <Button
          label={pushBusy ? tr('set.pushBusy') : tr('set.pushEnable')}
          variant="secondary"
          size="md"
          icon="notifications-outline"
          loading={pushBusy}
          disabled={pushBusy || pushTestBusy || !profile}
          onPress={handleReregisterPush}
        />
        {Platform.OS === 'android' ? (
          <Button
            label={tr('set.pushPopSettings')}
            variant="ghost"
            size="md"
            icon="settings-outline"
            disabled={pushBusy || pushTestBusy}
            onPress={handleOpenPopOnScreenSettings}
          />
        ) : null}
        <Button
          label={pushTestBusy ? tr('set.pushTestBusy') : tr('set.pushTest')}
          variant="ghost"
          size="md"
          icon="phone-portrait-outline"
          loading={pushTestBusy}
          disabled={pushBusy || pushTestBusy}
          onPress={handleStatusBarTest}
        />
        <SettingRow
          icon={pushDiagOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
          title={pushDiagOpen ? tr('set.diagHide') : tr('set.diagShow')}
          description={tr('set.diagHint')}
          onPress={() => setPushDiagOpen((v) => !v)}
        />
        {pushDiagOpen ? (
          <>
            {diag ? (
              <View style={{ gap: 6 }}>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {diag.permission === 'granted' ? '✅' : '❌'}{' '}{tr('set.diagPerm', { v: diag.permission })}
                </Text>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {diag.channelOk ? '✅' : '❌'}{' '}{tr('set.diagChannel', { v: diag.channelOk ? tr('set.ok') : tr('set.missingLow') })}
                </Text>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {(diag.tokensInDb ?? 0) > 0 ? '✅' : '❌'}{' '}{tr('set.diagToken', { v: diag.tokensInDb == null ? tr('set.unknown') : diag.tokensInDb })}
                </Text>
                <Text style={[styles.panelText, { color: t.colors.text }]}>
                  {diag.projectIdPresent ? '✅' : '❌'}{' '}{tr('set.diagEas', { v: diag.projectIdPresent ? tr('set.ok') : tr('set.easMissing') })}
                </Text>
                {diag.isDevice === false ? (
                  <Text style={[styles.panelText, { color: t.colors.text }]}>
                    ❌ {tr('set.diagSim')}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <Button
              label={diagBusy ? tr('set.diagBusy') : tr('set.diagCheck')}
              variant="ghost"
              size="md"
              icon="checkmark-circle-outline"
              loading={diagBusy}
              disabled={diagBusy || pushBusy || pushTestBusy || !profile}
              onPress={() => void handleRefreshDiagnostics()}
            />
            <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
              {Platform.OS === 'ios' ? tr('set.pushIosNote') : tr('set.pushAndroidNote')}
              {'\n\n'}
              {Platform.OS === 'ios' ? tr('set.pushIosSteps') : tr('set.pushAndroidSteps')}
            </Text>
          </>
        ) : null}
      </View>

      <SectionTitle>{tr('set.accountType')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {appMode === 'business' ? (
          <Badge tone="accent" icon="storefront-outline">
            {tr('set.bizAccount')}
          </Badge>
        ) : appMode === 'client' ? (
          <Badge tone="info" icon="person-outline">
            {tr('set.clientAccount')}
          </Badge>
        ) : (
          <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
            {tr('set.accountLoading')}
          </Text>
        )}
      </View>

      {appMode === 'business' ? (
        <>
          <SectionTitle>{tr('set.business')}</SectionTitle>
          {!businessId ? (
            <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
              <Callout tone="warning" title={tr('set.bizNotSetup')}>
                {tr('set.bizNotSetupHint')}
              </Callout>
              <Button
                label={tr('qr.setupBiz')}
                icon="construct-outline"
                onPress={() => router.push('/(app)/business/setup' as never)}
              />
            </View>
          ) : (
            <>
              <SettingRow
                icon="construct-outline"
                title={tr('set.setup')}
                description={bizName ? tr('set.editBiz', { name: bizName }) : tr('set.setupDesc')}
                onPress={() => router.push('/(app)/business/setup' as never)}
              />
              <SettingRow
                icon="qr-code-outline"
                title={tr('qr.title')}
                description={bizPublicCode ? tr('set.pubCodeRow', { code: bizPublicCode }) : tr('set.shareLink')}
                onPress={() => router.push('/(app)/business/qr' as never)}
              />
              <SettingRow
                icon="cut-outline"
                title={tr('svc.title')}
                description={hasServices ? tr('set.manageOffer') : tr('set.addFirstService')}
                onPress={() => router.push('/(app)/business/services' as never)}
              />
              <SettingRow
                icon="gift-outline"
                title={tr('pkg.title')}
                description={tr('pkg.subtitle')}
                onPress={() => router.push('/(app)/business/packages' as never)}
              />
              <SettingRow
                icon="people-outline"
                title={tr('team.title')}
                description={hasStaff ? tr('set.teamDesc') : tr('set.addStaff')}
                onPress={() => router.push('/(app)/business/staff' as never)}
              />

              <SectionTitle>{tr('gcal.title')}</SectionTitle>
              <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
                <Text style={[styles.panelText, { color: t.colors.textMuted }]}>{tr('gcal.desc')}</Text>
                {isGoogleConnected(gcalStatus) ? (
                  <>
                    <Badge tone="accent" icon="calendar-outline">
                      {tr('gcal.connected')}
                      {gcalStatus?.last_synced_at
                        ? ` · ${tr('gcal.lastSync', { when: new Date(gcalStatus.last_synced_at).toLocaleString() })}`
                        : ''}
                    </Badge>
                    <Button label={tr('gcal.syncNow')} variant="secondary" icon="sync-outline" loading={gcalBusy} onPress={() => void handleGoogleSync()} />
                    <Button label={tr('gcal.disconnect')} variant="secondary" icon="unlink-outline" loading={gcalBusy} onPress={() => void handleGoogleDisconnect()} />
                  </>
                ) : (
                  <Button label={tr('gcal.connect')} icon="logo-google" loading={gcalBusy} onPress={() => void handleGoogleConnect()} />
                )}
              </View>

              <SectionTitle>{tr('set.checklist')}</SectionTitle>
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
                  if (!logoUrl) extras.push(tr('set.extraLogo'));
                  if (!videoUrl) extras.push(tr('set.extraVideo'));
                  if (serviceState.kind === 'none') {
                    extras.push(tr('set.extraServiceNone'));
                  } else if (serviceState.kind === 'inactive') {
                    extras.push(
                      serviceState.names.length === 1
                        ? tr('set.extraServiceInactiveOne', { name: serviceState.names[0] })
                        : tr('set.extraServiceInactiveMany', {
                            list: serviceState.names.join(', '),
                          }),
                    );
                  }
                  if (!hasStaff) extras.push(tr('set.extraStaff'));
                  const allMissing = [...missing, ...extras.filter((e) => e !== tr('set.extraVideo'))];
                  if (allMissing.length === 0) {
                    return (
                      <Text style={[styles.panelText, { color: t.colors.success }]}>
                        {tr('set.cardComplete')}
                      </Text>
                    );
                  }
                  return (
                    <>
                      <Text style={[styles.panelText, { color: t.colors.textMuted }]}>
                        {tr('set.missingList', { list: allMissing.join(', ') })}
                      </Text>
                      {!missing.includes(tr('card.missingPhone')) ? null : (
                        <Text style={[styles.panelText, { color: t.colors.textFaint }]}>
                          {tr('set.phoneOptionalNote')}
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

      <SectionTitle>{tr('set.creds')}</SectionTitle>
      <View style={[styles.panel, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Field
          label="Email"
          value={emailInput}
          onChangeText={setEmailInput}
          placeholder={tr('set.emailPh')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          icon="mail-outline"
          hint={tr('set.emailHint')}
        />
        <Button
          label={credBusy ? tr('set.updating') : tr('set.updateEmail')}
          variant="secondary"
          size="md"
          icon="mail-outline"
          loading={credBusy}
          disabled={credBusy || saving}
          onPress={() => void handleUpdateEmail()}
        />
        <Field
          label={tr('set.newPass')}
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder={tr('set.passPh')}
          secureTextEntry
          icon="lock-closed-outline"
          autoCapitalize="none"
        />
        <Field
          label={tr('set.confirmPass')}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder={tr('set.confirmPassPh')}
          secureTextEntry
          icon="lock-closed-outline"
          autoCapitalize="none"
        />
        <Button
          label={credBusy ? tr('set.updating') : tr('set.changePass')}
          variant="secondary"
          size="md"
          icon="key-outline"
          loading={credBusy}
          disabled={credBusy || saving || !newPassword}
          onPress={() => void handleUpdatePassword()}
        />
      </View>

      <SectionTitle>{tr('set.account')}</SectionTitle>
      {!inBusinessTabs && appMode === 'client' ? (
        <SettingRow
          icon="chatbubbles-outline"
          title={tr('chat.title')}
          description={tr('set.chatDesc')}
          onPress={() => router.push('/(app)/chat' as never)}
        />
      ) : null}
            <SettingRow
        icon="download-outline"
        title={tr('set.exportData')}
        description={tr('set.accountData')}
        onPress={() => void handleExportData()}
      />
      <SettingRow
        icon="trash-outline"
        title={tr('set.deleteAccount')}
        description={tr('set.deleteAccountBody')}
        onPress={() => void handleDeleteAccount()}
        danger
      />
      <SettingRow
        icon="information-circle-outline"
        title={tr('set.deleteAccountInfo')}
        description={tr('set.deleteAccountInfoHint')}
        onPress={() =>
          void Linking.openURL(`${getPublicWebOrigin()}/delete-account.html?lang=${getLanguageSync()}`)
        }
      />
<SettingRow
        icon="log-out-outline"
        title={tr('set.logout')}
        description={tr('set.logoutHint')}
        onPress={handleLogout}
        danger
      />

      <Text
        style={[styles.versionFooter, { color: t.colors.textFaint }]}
        accessibilityLabel={tr('set.version', { v: getAppVersionLabel() })}
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
