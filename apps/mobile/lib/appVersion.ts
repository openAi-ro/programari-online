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
