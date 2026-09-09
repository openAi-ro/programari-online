import { Platform } from 'react-native';
import { router } from 'expo-router';

import { supabase } from './supabase';

// expo-notifications throws at import time in Expo Go (SDK 53+), so we load it
// lazily inside the functions that actually need it. This keeps the rest of the
// app working even when remote push isn't available (Expo Go / web / simulator).
async function loadNotifications(): Promise<typeof import('expo-notifications') | null> {
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
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
  const Device = await import('expo-device');
  if (!Device.isDevice) {
    return { token: null, reason: 'simulator' };
  }

  const Notifications = await loadNotifications();
  if (!Notifications) {
    return { token: null, reason: 'push_unavailable' };
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    return { token: null, reason: 'permission_denied' };
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  const { error } = await supabase.from('device_push_tokens').upsert(
    {
      user_id: userId,
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

/** Navigate from push tap payload (data.screen / appointmentId). */
export function handleNotificationNavigation(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const screen = typeof data.screen === 'string' ? data.screen : null;
  if (screen === 'requests') {
    router.push('/(app)/business/requests');
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
  (async () => {
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
      // keep a handle so the caller can detach
      cleanupRef = () => sub.remove();
    }
  })();
  return () => {
    cancelled = true;
    cleanupRef?.();
  };
}

let cleanupRef: (() => void) | null = null;

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