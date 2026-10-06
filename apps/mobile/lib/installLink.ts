import { Platform } from 'react-native';
import Constants from 'expo-constants';

const DEFAULT_ANDROID_INSTALL_URL =
  'https://expo.dev/accounts/promixt/projects/programari/builds/4a07edea-1504-4892-adc5-fe8d685c428d';

/** PWA publică (Safari pe iPhone → Adaugă pe ecranul Home). Firebase Hosting. */
const DEFAULT_IOS_PWA_URL = 'https://programari.expo.app/login';

const DEFAULT_WEB_BASE = 'https://programari.expo.app';

type Extra = {
  installUrl?: string;
  iosInstallUrl?: string;
  webBaseUrl?: string;
};

function trimUrl(value: string | undefined | null): string | null {
  const v = value?.trim().replace(/\/$/, '');
  return v || null;
}

function extra(): Extra | undefined {
  return Constants.expoConfig?.extra as Extra | undefined;
}

function resolveUrl(envValue: string | undefined, extraValue: string | undefined): string | null {
  return trimUrl(envValue) ?? trimUrl(extraValue);
}

/** Baza web (PWA / site). */
export function getWebBaseUrl(): string {
  return (
    resolveUrl(process.env.EXPO_PUBLIC_WEB_BASE_URL, extra()?.webBaseUrl) ?? DEFAULT_WEB_BASE
  );
}

/** Link descărcare Android (APK / pagina Expo build). */
export function getAndroidInstallUrl(): string {
  return (
    resolveUrl(process.env.EXPO_PUBLIC_INSTALL_URL, extra()?.installUrl) ??
    DEFAULT_ANDROID_INSTALL_URL
  );
}

/**
 * Link instalare iOS.
 * Implicit: PWA pe HTTPS (Safari → Partajează → Pe ecranul Home).
 * Poate fi înlocuit cu TestFlight / App Store via EXPO_PUBLIC_IOS_INSTALL_URL.
 */
export function getIosInstallUrl(): string {
  const configured = resolveUrl(process.env.EXPO_PUBLIC_IOS_INSTALL_URL, extra()?.iosInstallUrl);
  if (configured) return configured;
  // Preferă Firebase Hosting (HTTPS PWA); fallback pe webBase + /install
  const base = getWebBaseUrl();
  if (/programari-online-50c3e\.web\.app/i.test(base) || /programari\.expo\.app/i.test(base)) {
    return `${base}/login`;
  }
  return DEFAULT_IOS_PWA_URL;
}

/**
 * Link pe care îl scanează cine nu are încă aplicația.
 * Pe iPhone native folosește URL-ul iOS; altfel Android.
 * @deprecated Preferă getAndroidInstallUrl / getIosInstallUrl pe pagina /install.
 */
export function getInstallUrl(): string {
  if (Platform.OS === 'ios') return getIosInstallUrl();
  return getAndroidInstallUrl();
}

/** True dacă linkul e un fișier descărcabil direct (nu o pagină). */
export function isDirectFileUrl(url: string): boolean {
  return /\.apk(\?|#|$)/i.test(url) || /\.ipa(\?|#|$)/i.test(url);
}