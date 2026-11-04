import { Platform } from 'react-native';

import { ensureMyProfile } from './bookingRpc';
import { supabase } from './supabase';

/**
 * Web Push pentru PWA instalată (iOS-2). Pe iPhone, Expo Push nu există;
 * abonamentul PushManager se salvează în web_push_subscriptions și Edge
 * Functions trimit prin protocolul Web Push cu cheile VAPID de pe server.
 * Cheia publică VAPID vine din EXPO_PUBLIC_VAPID_PUBLIC_KEY.
 */

export type WebPushResult = { ok: boolean; reason?: string };

function vapidPublicKey(): string | null {
  const key = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  return key ? key : null;
}

export function isWebPushConfigured(): boolean {
  return vapidPublicKey() != null;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isStandaloneWebApp(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  try {
    return window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

export async function registerWebPushAsync(): Promise<WebPushResult> {
  if (Platform.OS !== 'web') return { ok: false, reason: 'not_web' };
  const publicKey = vapidPublicKey();
  if (!publicKey) return { ok: false, reason: 'vapid_missing' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'push_unsupported' };
  }
  // iOS cere PWA instalată pe ecranul de start pentru Web Push (16.4+).
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (isIos && !isStandaloneWebApp()) return { ok: false, reason: 'ios_needs_install' };

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: 'permission_denied' };

  const profileReady = await ensureMyProfile();
  if (!profileReady.ok) return { ok: false, reason: profileReady.error };

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
    }
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh ?? bufferToBase64Url(subscription.getKey('p256dh'));
    const auth = json.keys?.auth ?? bufferToBase64Url(subscription.getKey('auth'));
    if (!subscription.endpoint || !p256dh || !auth) {
      return { ok: false, reason: 'subscription_incomplete' };
    }
    const { error } = await supabase.from('web_push_subscriptions').upsert(
      {
        user_id: profileReady.userId,
        endpoint: subscription.endpoint,
        p256dh,
        auth,
        user_agent: window.navigator.userAgent.slice(0, 300),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,endpoint' },
    );
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'subscribe_failed' };
  }
}

export async function unregisterWebPushAsync(): Promise<void> {
  try {
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    await supabase.from('web_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    await subscription.unsubscribe();
  } catch {
    // best-effort la deconectare
  }
}

export async function hasWebPushSubscription(): Promise<boolean> {
  try {
    if (Platform.OS !== 'web' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return false;
    }
    const registration = await navigator.serviceWorker.ready;
    return (await registration.pushManager.getSubscription()) != null;
  } catch {
    return false;
  }
}
