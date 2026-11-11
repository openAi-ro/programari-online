import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

import { BOOT_LOGO_DATA_URI } from '@/constants/bootLogo';

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
 * Reîncarcă aplicația pe update-ul descărcat. Ecranul nativ de reîncărcare arată
 * același logo (57 dp), pe același fundal și în aceeași poziție ca loaderul de pornire,
 * în locul ecranului alb cu spinner implicit din expo-updates.
 */
export function reloadWithBootScreen(): Promise<void> {
  return Updates.reloadAsync({
    reloadScreenOptions: {
      backgroundColor: '#f1f5f9',
      image: { url: BOOT_LOGO_DATA_URI, width: 57, height: 57, scale: 1 },
      imageResizeMode: 'contain',
      spinner: { enabled: false },
      fade: true,
    },
  });
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
    await reloadWithBootScreen();
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
 * Versiunea pentru care am încercat deja actualizarea: web = bundle-ul publicat (sessionStorage),
 * native = id-ul EAS Update (AsyncStorage). Dacă după reîncărcare tot versiunea veche rulează,
 * bannerul spune asta în loc să ofere din nou același buton.
 */
const TRIED_KEY = 'programari.updateTried';

async function getTried(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return window.sessionStorage.getItem(TRIED_KEY);
    return await AsyncStorage.getItem(TRIED_KEY);
  } catch {
    return null;
  }
}

async function setTried(version: string | null): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (version) window.sessionStorage.setItem(TRIED_KEY, version);
      else window.sessionStorage.removeItem(TRIED_KEY);
      return;
    }
    if (version) await AsyncStorage.setItem(TRIED_KEY, version);
    else await AsyncStorage.removeItem(TRIED_KEY);
  } catch {
    // Fără stocare: bannerul doar nu mai știe că a încercat deja.
  }
}

/** Id-ul update-ului EAS oferit de server (lipsă la „roll back to embedded”). */
function offeredUpdateId(check: Updates.UpdateCheckResult): string | null {
  const manifest = check.manifest as { id?: string } | undefined;
  return manifest?.id ?? null;
}

/**
 * - `none`: rulează ultima versiune (sau verificarea n-a putut fi făcută);
 * - `available`: există o versiune mai nouă decât cea care rulează;
 * - `stuck`: am reîncărcat deja pentru versiunea asta și tot cea veche rulează (fără buclă).
 */
export type UpdateBannerState = 'none' | 'available' | 'stuck';

/**
 * Banner-ul apare doar cand exista cu adevarat o versiune mai noua decat cea
 * care ruleaza:
 * - web: bundle-ul publicat pe server difera de cel incarcat in pagina;
 * - native: EAS raporteaza un update disponibil.
 */
export async function updateBannerState(): Promise<UpdateBannerState> {
  if (Platform.OS === 'web') {
    const loaded = loadedWebEntry();
    if (!loaded) return 'none';
    const published = await publishedWebEntry();
    if (published === null) return 'none';
    if (published === loaded) {
      await setTried(null);
      return 'none';
    }
    return (await getTried()) === published ? 'stuck' : 'available';
  }
  if (!canApplyOtaUpdates()) return 'none';
  try {
    // OTA (EAS Update pe canalul build-ului), nu versiunea web.
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      await setTried(null);
      return 'none';
    }
    const offered = offeredUpdateId(check);
    return offered && (await getTried()) === offered ? 'stuck' : 'available';
  } catch {
    return 'none';
  }
}

/**
 * „Actualizează acum”. `reloading` = reîncărcarea a pornit; `upToDate` = rulează deja ultima
 * versiune. O verificare sau o descărcare eșuată aruncă eroare (bannerul arată mesajul).
 * Web: doar reîncarcă pagina (cu parametru unic, ca CDN-ul să dea HTML-ul nou). Service
 * worker-ul (v6) cere navigările din rețea, iar fișierele cu hash nu se schimbă, deci nu
 * dezînregistrăm SW-ul (ar pierde și abonamentul la notificări) și nu golim cache-urile.
 */
export async function applyUpdateNow(): Promise<'reloading' | 'upToDate'> {
  if (Platform.OS === 'web') {
    const loaded = loadedWebEntry();
    const published = await publishedWebEntry();
    if (!published) throw new Error('update_check_failed');
    if (published === loaded) return 'upToDate';
    await setTried(published);
    const url = new URL(window.location.href);
    url.searchParams.set('_r', String(Date.now()));
    window.location.replace(url.toString());
    return 'reloading';
  }
  if (!canApplyOtaUpdates()) return 'upToDate';
  const check = await Updates.checkForUpdateAsync();
  if (!check.isAvailable) return 'upToDate';
  // isNew=false: era deja descărcat la pornire; reload-ul îl pornește oricum.
  await Updates.fetchUpdateAsync();
  await setTried(offeredUpdateId(check));
  await reloadWithBootScreen();
  return 'reloading';
}
