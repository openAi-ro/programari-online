import { Linking, Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import { router } from 'expo-router';

import { ensureMyProfile } from './bookingRpc';
import { trKey } from './i18n';
import { setAppMode } from './appMode';
import { supabase } from './supabase';
import { getCurrentUser } from './currentUser';

/**
 * Canal Android pentru cereri — importance MAX = „Pop on screen”.
 * ID nou la fiecare reset: Android NU ridică importance-ul unui canal deja creat
 * și pe multe telefoane „Pop on screen” rămâne oprit până îl activezi manual.
 */
export const BOOKING_PUSH_CHANNEL_ID = 'cereri_heads';

export const CHAT_PUSH_CHANNEL_ID = 'chat_heads';

const LEGACY_CHANNEL_IDS = ['cereri', 'cereri_v2'] as const;

// expo-notifications: pe Android Expo Go (SDK 53+) importul aruncă Error.
// Nu încărcăm modulul deloc în Expo Go / web; în build nativ îl încărcăm lazy.
async function loadNotifications(): Promise<typeof import('expo-notifications') | null> {
  // SDK 53+: pe Android, importul expo-notifications din Expo Go ARUNCĂ Error
  // (push remote scos). Nu încărcăm deloc modulul acolo — vibrație/fallback rămân.
  if (Platform.OS === 'web' || isRunningInExpoGo()) {
    return null;
  }
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

let handlerConfigured = false;

/** Deschide setările canalului pe Android (acolo e toggle-ul „Pop on screen”). */
export async function openBookingChannelSettings(): Promise<{ ok: boolean; reason?: string }> {
  if (Platform.OS !== 'android') {
    await Linking.openSettings();
    return { ok: true };
  }
  await configureNotificationPresentation();
  const pkg = Constants.expoConfig?.android?.package ?? 'com.programari.app';
  try {
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
      { key: 'android.provider.extra.CHANNEL_ID', value: BOOKING_PUSH_CHANNEL_ID },
    ]);
    return { ok: true };
  } catch {
    try {
      await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
      ]);
      return { ok: true };
    } catch {
      await Linking.openSettings();
      return { ok: true, reason: 'opened_app_settings' };
    }
  }
}

async function ensureHeadsUpChannel(
  Notifications: NonNullable<Awaited<ReturnType<typeof loadNotifications>>>
): Promise<void> {
  // Ștergem canalele vechi ca să nu rămână „Pop on screen” oprit pe ID-uri blocate.
  for (const id of LEGACY_CHANNEL_IDS) {
    try {
      await Notifications.deleteNotificationChannelAsync(id);
    } catch {
      // ignore — canalul poate să nu existe
    }
  }

  // Android NU ridică importance-ul unui canal deja creat. Dacă canalul există
  // cu importance mică (utilizatorul/sistemul l-a coborât sau a rămas de la un
  // build vechi), îl ștergem și îl recreăm cu MAX — altfel push-ul remote
  // ajunge în listă dar FĂRĂ popup pe ecran, inclusiv cu app-ul închis.
  if (Platform.OS === 'android') {
    try {
      const existing = await Notifications.getNotificationChannelAsync(
        BOOKING_PUSH_CHANNEL_ID
      );
      const importance = existing?.importance ?? 0;
      if (existing && importance > 0 && importance < Notifications.AndroidImportance.MAX) {
        await Notifications.deleteNotificationChannelAsync(BOOKING_PUSH_CHANNEL_ID);
      }
    } catch {
      // ignore — recreăm canalul mai jos oricum
    }
  }

  await Notifications.setNotificationChannelAsync(BOOKING_PUSH_CHANNEL_ID, {
    name: trKey('push.chanBooking'),
    description: trKey('push.chanBookingDesc'),
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 120, 250],
    lightColor: '#7C3AED',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    enableVibrate: true,
    enableLights: true,
    showBadge: true,
    sound: 'default',
  });

  // Canal de chat — importance MAX ca pop-urile de mesaje să apare și cu
  // aplicația închisă / pe ecranul de bloare.
  await Notifications.setNotificationChannelAsync(CHAT_PUSH_CHANNEL_ID, {
    name: trKey('push.chanChat'),
    description: trKey('push.chanChatDesc'),
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 100, 80, 100],
    lightColor: '#0EA5E9',
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    bypassDnd: false,
    enableVibrate: true,
    enableLights: true,
    showBadge: true,
    sound: 'default',
  });

  await Notifications.setNotificationChannelAsync('default', {
    name: trKey('push.chanGeneral'),
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    enableVibrate: true,
  });
}

/** Afișează banner + sunet și când aplicația e deschisă. */
export async function configureNotificationPresentation(): Promise<void> {
  if (handlerConfigured || Platform.OS === 'web') return;
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
    }),
  });

  if (Platform.OS === 'android') {
    await ensureHeadsUpChannel(Notifications);
  }

  handlerConfigured = true;
}

/**
 * Popup local în bara de notificări pentru business când vine o cerere nouă.
 * Se folosește ca fallback la push-ul remote (Expo Push): dacă aplicația e
 * deschisă / în background și sosește un INSERT realtime, afișăm heads-up
 * pe canalul `cereri_heads` (importance MAX = „Pop on screen").
 * Nu depinde de token FCM / webhook — merge cât timp app-ul rulează.
 */
export async function presentLocalBookingNotification(opts: {
  title?: string;
  body: string;
  appointmentId?: string;
  businessId?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web_unsupported' };
  }
  // Vibrație tactilă imediată — codul ăsta rulează doar cu app-ul viu, iar în
  // Expo Go (fără push nativ) sau cu app-ul deschis e singurul semnal sigur
  // că a venit o cerere. Nu costă nimic când notificarea de sistem apare oricum.
  try {
    Vibration.vibrate([0, 250, 120, 250]);
  } catch {
    // ignore — unele medii nu au motor de vibrație
  }
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return { ok: false, reason: 'push_unavailable' };
  }
  await configureNotificationPresentation();

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title ?? trKey('notif.newBookingTitle'),
        body: opts.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 250, 120, 250],
        data: {
          screen: 'requests',
          appointmentId: opts.appointmentId ?? null,
          businessId: opts.businessId ?? null,
        },
      },
      // null = imediat; pe Android folosește canalul cu importance MAX.
      trigger:
        Platform.OS === 'android'
          ? { channelId: BOOKING_PUSH_CHANNEL_ID }
          : null,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'schedule_failed',
    };
  }
}

/**
 * Popup local în bara de notificări pentru un mesaj de chat nou.
 * Fallback pentru push-ul remote (Expo Push): când aplicația e deschisă / în
 * background și sosește un INSERT realtime pe chat_messages, afișăm heads-up
 * pe canalul `chat_heads` (importance MAX = „Pop on screen").
 */
export async function presentLocalChatNotification(opts: {
  title?: string;
  body: string;
  conversationId?: string;
  businessId?: string;
  isClient?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web_unsupported' };
  }
  // Vibrație tactilă imediată — codul ăsta rulează doar cu app-ul viu.
  try {
    Vibration.vibrate([0, 100, 80, 100]);
  } catch {
    // ignore — unele medii nu au motor de vibrație
  }
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return { ok: false, reason: 'push_unavailable' };
  }
  await configureNotificationPresentation();

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: opts.title ?? trKey('notif.newMessage'),
        body: opts.body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 100, 80, 100],
        data: {
          screen: 'chat',
          conversationId: opts.conversationId ?? null,
          businessId: opts.businessId ?? null,
          isClient: opts.isClient ?? null,
        },
      },
      trigger:
        Platform.OS === 'android'
          ? { channelId: CHAT_PUSH_CHANNEL_ID }
          : null,
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : 'schedule_failed',
    };
  }
}

/**
 * Test local pentru „Pop on screen”: trimite după câteva secunde ca să poți
 * minimaliza app-ul — Android rareori face heads-up cât timp ești în aplicație.
 */
export async function presentStatusBarTestNotification(): Promise<{
  ok: boolean;
  reason?: string;
  delaySec?: number;
}> {
  if (Platform.OS === 'web') {
    return { ok: false, reason: 'web_unsupported' };
  }
  const Notifications = await loadNotifications();
  if (!Notifications) {
    return { ok: false, reason: 'push_unavailable' };
  }
  // Forțează recrearea canalului (chiar dacă handlerConfigured e deja true).
  handlerConfigured = false;
  await configureNotificationPresentation();

  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    if (req.status !== 'granted') {
      return { ok: false, reason: 'permission_denied' };
    }
  }

  const channel = await Notifications.getNotificationChannelAsync(BOOKING_PUSH_CHANNEL_ID);
  const importance = channel?.importance ?? 0;
  // MAX=7, HIGH=6 — sub HIGH nu există heads-up.
  if (Platform.OS === 'android' && importance > 0 && importance < 6) {
    return { ok: false, reason: 'channel_importance_low' };
  }

  const delaySec = 5;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: trKey('push.testTitle'),
      body: trKey('push.testBody'),
      sound: true,
      priority: Notifications.AndroidNotificationPriority.MAX,
      vibrate: [0, 250, 120, 250],
      data: { screen: 'requests', test: true },
    },
    trigger:
      Platform.OS === 'android'
        ? {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: delaySec,
            channelId: BOOKING_PUSH_CHANNEL_ID,
          }
        : {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: delaySec,
          },
  });
  return { ok: true, delaySec };
}

export type PushRegisterResult = {
  token: string | null;
  reason?: string;
};

/**
 * Request permission, get Expo push token, upsert into device_push_tokens.
 */
export async function registerForPushAsync(userId: string): Promise<PushRegisterResult> {
  if (Platform.OS === 'web') {
    return { token: null, reason: 'web_unsupported' };
  }
  if (isRunningInExpoGo()) {
    return { token: null, reason: 'expo_go_no_remote_push' };
  }
  const Device = await import('expo-device');
  if (!Device.isDevice) {
    return { token: null, reason: 'simulator' };
  }

  const Notifications = await loadNotifications();
  if (!Notifications) {
    return { token: null, reason: 'push_unavailable' };
  }

  await configureNotificationPresentation();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return { token: null, reason: 'permission_denied' };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { token: null, reason: 'missing_project_id' };
  }

  const profileReady = await ensureMyProfile();
  if (!profileReady.ok) {
    return { token: null, reason: profileReady.error };
  }

  let token: string;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenData.data;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'push_token_failed';
    console.warn('registerForPushAsync token failed', reason);
    return { token: null, reason: mapPushTokenError(reason) };
  }
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  const { error } = await supabase.from('device_push_tokens').upsert(
    {
      user_id: profileReady.userId,
      expo_push_token: token,
      platform,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,expo_push_token' }
  );

  if (error) {
    console.warn('registerForPushAsync upsert failed', error.message);
    return { token: null, reason: error.message };
  }

  return { token };
}

/**
 * Șterge token-ul push al acestui dispozitiv din `device_push_tokens`.
 * Se apelează la deconectare, ca un telefon vândut / cont schimbat să nu mai
 * primească popup-urile business-ului când app-ul e închis (push remote).
 */
export async function unregisterCurrentPushToken(): Promise<void> {
  try {
    if (Platform.OS === 'web') return;
    const Device = await import('expo-device');
    if (!Device.isDevice) return;
    const Notifications = await loadNotifications();
    if (!Notifications) return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return;
    let token: string | null = null;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data ?? null;
    } catch {
      return;
    }
    if (!token) return;
    const user = await getCurrentUser();
    if (!user) return;
    await supabase
      .from('device_push_tokens')
      .delete()
      .eq('user_id', user.id)
      .eq('expo_push_token', token);
  } catch {
    // best-effort — logout-ul continuă oricum
  }
}

export type PushDiagnostics = {
  permission: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  channelImportance: number | null;
  channelOk: boolean;
  tokensInDb: number | null;
  projectIdPresent: boolean;
  isDevice: boolean | null;
};

/**
 * Verificare cap-coadă pentru push remote (app închis): permisiune sistem,
 * canal Android cu importance pentru popup, projectId EAS și token în DB.
 * Folosit în Setări → cardul de diagnostic.
 */
export async function getPushDiagnostics(userId: string): Promise<PushDiagnostics> {
  const fallback: PushDiagnostics = {
    permission: 'unavailable',
    channelImportance: null,
    channelOk: false,
    tokensInDb: null,
    projectIdPresent: false,
    isDevice: null,
  };
  if (Platform.OS === 'web') return fallback;
  const Notifications = await loadNotifications();
  if (!Notifications) return fallback;

  let isDevice: boolean | null = null;
  try {
    const Device = await import('expo-device');
    isDevice = Device.isDevice;
  } catch {
    isDevice = null;
  }

  let permission: PushDiagnostics['permission'] = 'undetermined';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    permission = status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch {
    permission = 'unavailable';
  }

  let channelImportance: number | null = null;
  let channelOk = false;
  if (Platform.OS === 'android') {
    try {
      await configureNotificationPresentation();
      const channel = await Notifications.getNotificationChannelAsync(
        BOOKING_PUSH_CHANNEL_ID
      );
      channelImportance = channel?.importance ?? null;
      channelOk =
        channelImportance != null &&
        channelImportance >= Notifications.AndroidImportance.HIGH;
    } catch {
      channelOk = false;
    }
  } else {
    channelOk = permission === 'granted';
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const projectIdPresent = Boolean(projectId);

  let tokensInDb: number | null = null;
  try {
    const { count } = await supabase
      .from('device_push_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    tokensInDb = count ?? 0;
  } catch {
    tokensInDb = null;
  }

  return { permission, channelImportance, channelOk, tokensInDb, projectIdPresent, isDevice };
}

/** Mesaje clare pentru erori tipice FCM / google-services pe Android. */
export function mapPushTokenError(raw: string): string {
  const m = raw.toLowerCase();
  if (
    m.includes('google services') ||
    m.includes('google-services') ||
    m.includes('googleservices') ||
    m.includes('firebaseapp') ||
    m.includes('default firebaseapp') ||
    m.includes('firebase') ||
    m.includes('fcm') ||
    m.includes('missing_instanceid_service')
  ) {
    return trKey('push.fcmMissing');
  }
  if (m.includes('permission') || m.includes('denied')) {
    return 'permission_denied';
  }
  return raw;
}

/** Navigate from push tap payload (data.screen / appointmentId / conversationId). */
export function handleNotificationNavigation(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const screen = typeof data.screen === 'string' ? data.screen : null;

  if (screen === 'requests') {
    void setAppMode('business');
    // v87: push-ul 'Reprogramare cerută' deschide filtrul De decis pe cardul respectiv.
    const params: Record<string, string> = {};
    if (typeof data.appointmentId === 'string' && data.appointmentId) params.focus = data.appointmentId;
    if (data.filter === 'decide') params.filter = 'decide';
    router.push({ pathname: '/(app)/business/(tabs)/requests', params } as never);
    return;
  }

  if (screen === 'my-appointments') {
    void setAppMode('client');
    router.push('/(app)/my-appointments');
    return;
  }

  if (screen === 'chat' && typeof data.conversationId === 'string' && data.conversationId) {
    // Determină rolul și deschide fîșioara de conversație corespunzătoare.
    const isClient = data.isClient === true;
    const path = isClient
      ? `/(app)/chat/${data.conversationId}`
      : `/(app)/business/chat/${data.conversationId}`;
    void setAppMode(isClient ? 'client' : 'business');
    router.push(path as never);
  }
}

/**
 * Subscribe to notification response (user taps notification).
 * Returns cleanup function.
 */
export function attachNotificationResponseListener() {
  if (Platform.OS === 'web') {
    return () => {};
  }
  // In Expo Go (SDK 53+) remote push isn't available; skip silently.
  let cancelled = false;
  let unsubscribe: (() => void) | null = null;
  (async () => {
    await configureNotificationPresentation();
    const Notifications = await loadNotifications();
    if (!Notifications || cancelled) return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      handleNotificationNavigation(data);
    });
    if (cancelled) {
      sub.remove();
    } else {
      unsubscribe = () => sub.remove();
    }
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** If app was opened from a cold-start notification tap. */
export async function consumeLastNotificationResponse() {
  if (Platform.OS === 'web') return;
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  const last = await Notifications.getLastNotificationResponseAsync();
  if (!last) return;
  const data = last.notification.request.content.data as Record<string, unknown> | undefined;
  handleNotificationNavigation(data);
}
