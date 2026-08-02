import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { router } from 'expo-router';

import { supabase } from './supabase';

// Avoid calling native notification APIs during web SSR / Node.
if (Platform.OS !== 'web' && typeof window !== 'undefined') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
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
  if (!Device.isDevice) {
    return { token: null, reason: 'simulator' };
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
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as
      | Record<string, unknown>
      | undefined;
    handleNotificationNavigation(data);
  });
  return () => sub.remove();
}

/** If app was opened from a cold-start notification tap. */
export async function consumeLastNotificationResponse() {
  if (Platform.OS === 'web') return;
  const last = await Notifications.getLastNotificationResponseAsync();
  if (!last) return;
  const data = last.notification.request.content.data as Record<string, unknown> | undefined;
  handleNotificationNavigation(data);
}
