import { Platform } from 'react-native';
import Constants from 'expo-constants';

const DEFAULT_INSTALL_URL =
  'https://expo.dev/accounts/promixt/projects/programari/builds/62281174-35e7-456e-b377-496c990442dc';

type Extra = { installUrl?: string; iosInstallUrl?: string };

function resolveUrl(envValue: string | undefined, extraValue: string | undefined): string | null {
  const fromEnv = envValue?.trim().replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  const fromExtra = extraValue?.trim();
  if (fromExtra) return fromExtra;
  return null;
}

/** Link HTTPS pe care îl scanează cine nu are încă aplicația (APK / pagină Expo). */
export function getInstallUrl(): string {
  const extra = Constants.expoConfig?.extra as Extra | undefined;
  // Pe iPhone, APK-ul de Android e inutil — folosește linkul de iOS
  // (TestFlight / build ad-hoc) când e configurat.
  if (Platform.OS === 'ios') {
    const ios = resolveUrl(process.env.EXPO_PUBLIC_IOS_INSTALL_URL, extra?.iosInstallUrl);
    if (ios) return ios;
  }
  return (
    resolveUrl(process.env.EXPO_PUBLIC_INSTALL_URL, extra?.installUrl) ?? DEFAULT_INSTALL_URL
  );
}

/** True dacă linkul de instalare e un fișier descărcabil direct (nu o pagină). */
export function isDirectFileUrl(url: string): boolean {
  return /\.apk(\?|#|$)/i.test(url) || /\.ipa(\?|#|$)/i.test(url);
}
