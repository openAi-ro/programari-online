import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

type Extra = { displayVersion?: string };

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

const WEB_ENTRY_RE = /\/_expo\/static\/js\/web\/entry-[a-f0-9]+\.js/;

/** Bundle-ul web incarcat acum (din tag-ul <script>). */
function loadedWebEntry(): string | null {
  if (typeof document === 'undefined') return null;
  for (const el of Array.from(document.scripts)) {
    const m = el.src.match(WEB_ENTRY_RE);
    if (m) return m[0];
  }
  return null;
}

/** Bundle-ul web publicat acum pe server (index.html fara cache). */
async function publishedWebEntry(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).match(WEB_ENTRY_RE)?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Banner-ul apare doar cand exista cu adevarat o versiune mai noua decat cea
 * care ruleaza:
 * - web: bundle-ul publicat pe server difera de cel incarcat in pagina;
 * - native: EAS raporteaza un update disponibil.
 * O incarcare proaspata (sau prima deschidere) nu mai arata banner-ul.
 */
export async function shouldShowUpdateBanner(): Promise<boolean> {
  if (Platform.OS === 'web') {
    const loaded = loadedWebEntry();
    if (!loaded) return false;
    const published = await publishedWebEntry();
    return published !== null && published !== loaded;
  }
  if (!canApplyOtaUpdates()) return false;
  try {
    const check = await Updates.checkForUpdateAsync();
    return check.isAvailable;
  } catch {
    return false;
  }
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
  if (Platform.OS === 'web') {
    await hardRefreshWeb();
    return;
  }

  await forceNativeUpdateAndReload();
}
