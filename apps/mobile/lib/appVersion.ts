import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

type Extra = { displayVersion?: string };

const SEEN_KEY = 'programari.updateBanner.seenVersion';

/**
 * Versiunea afișată pe login.
 * `extra.displayVersion` se poate schimba la fiecare EAS Update;
 * `expo.version` rămâne cea a binarelor instalate (runtime OTA).
 */
export function getAppVersion(): string {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  const fromExtra = extra?.displayVersion?.trim();
  if (fromExtra) return fromExtra;
  const fromConfig = Constants.expoConfig?.version?.trim();
  if (fromConfig) return fromConfig;
  const native = Constants.nativeAppVersion?.trim();
  if (native) return native;
  return '0.0.0';
}

export function getAppVersionLabel(): string {
  return `v${getAppVersion()}`;
}

export function canApplyOtaUpdates(): boolean {
  if (__DEV__) return false;
  if (Platform.OS === 'web') return false;
  return Updates.isEnabled;
}

/**
 * Descarcă update-ul EAS și îl aplică imediat (reload), nu la a doua deschidere.
 */
export async function applyAvailableUpdate(): Promise<void> {
  if (!canApplyOtaUpdates()) return;
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return;
    try {
      await Updates.fetchUpdateAsync();
    } catch (e) {
      // Poate fi deja descărcat de verificarea nativă de la pornire.
      console.warn('OTA fetch', e);
    }
    await Updates.reloadAsync();
  } catch (e) {
    console.warn('OTA check failed', e);
  }
}

/** Așteaptă update-ul; după `ms` pornește app-ul, iar descărcarea continuă în fundal. */
export async function applyAvailableUpdateWithTimeout(ms = 20000): Promise<void> {
  await Promise.race([
    applyAvailableUpdate(),
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

async function readSeenVersion(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return webStore()?.getItem(SEEN_KEY) ?? null;
    }
    return await AsyncStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

async function writeSeenVersion(version: string): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      webStore()?.setItem(SEEN_KEY, version);
      return;
    }
    await AsyncStorage.setItem(SEEN_KEY, version);
  } catch (e) {
    console.warn('updateBanner persist', e);
  }
}

/** Afișează banner-ul o dată per `displayVersion` până la refresh reușit. */
export async function shouldShowUpdateBanner(): Promise<boolean> {
  const current = getAppVersion();
  const seen = await readSeenVersion();
  return seen !== current;
}

export async function markUpdateBannerSeen(version = getAppVersion()): Promise<void> {
  await writeSeenVersion(version);
}

async function hardRefreshWeb(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
  } catch (e) {
    console.warn('SW unregister', e);
  }

  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch (e) {
    console.warn('caches clear', e);
  }

  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()));
  window.location.replace(url.toString());
}

async function forceNativeUpdateAndReload(): Promise<void> {
  if (canApplyOtaUpdates()) {
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        try {
          await Updates.fetchUpdateAsync();
        } catch (e) {
          console.warn('OTA fetch on banner', e);
        }
      }
    } catch (e) {
      console.warn('OTA check on banner', e);
    }
  }

  try {
    await Updates.reloadAsync();
  } catch (e) {
    console.warn('Updates.reloadAsync failed', e);
    // Ultima șansă pe native fără Updates: nu există echivalent sigur.
  }
}

/**
 * Hard refresh + aplică update:
 * - native: check/fetch EAS Update, apoi reload (chiar dacă nu e update nou)
 * - web: unregister SW, golește Cache Storage, reload cu cache-buster
 */
export async function forceHardRefreshAndUpdate(): Promise<void> {
  await markUpdateBannerSeen();

  if (Platform.OS === 'web') {
    await hardRefreshWeb();
    return;
  }

  await forceNativeUpdateAndReload();
}
