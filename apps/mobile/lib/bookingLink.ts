import * as Linking from 'expo-linking';

import { getPublicWebOrigin } from './webBase';

/**
 * Link-uri pentru QR / deep link către ecranul de programare.
 *
 * - HTTPS public: /b/CODE (Instagram, WhatsApp, camera nativă, browser)
 * - În Expo Go: Linking.createURL (doar expoUrl, nu webUrl)
 * - Native: programari://b/CODE
 */

export function getWebBookingUrl(publicCode: string): string {
  const code = publicCode.trim().toLowerCase();
  return `${getPublicWebOrigin()}/b/${code}`;
}

export function getMyAppointmentsUrl(): string {
  return `${getPublicWebOrigin()}/my-appointments`;
}

export function getBookingPaths(publicCode: string) {
  const code = publicCode.trim().toLowerCase();
  const webUrl = getWebBookingUrl(code);
  return {
    code,
    webUrl,
    /** Preferat în dezvoltare (Expo Go) — include host-ul Metro */
    expoUrl: Linking.createURL(`book/${code}`),
    /** Scheme app (funcționează după build APK/IPA, nu mereu în Expo Go) */
    appScheme: `programari://b/${code}`,
    /** Path intern expo-router */
    route: `/(app)/book/${code}` as const,
    publicRoute: `/b/${code}` as const,
  };
}

/** Extrage public_code din orice formă de QR / link. */
export function extractPublicCode(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  // programari://b/CODE
  let m = value.match(/^programari:\/\/b\/([a-z0-9]+)/i);
  if (m?.[1]) return m[1].toLowerCase();

  // exp://.../--/book/CODE  or  .../book/CODE
  m = value.match(/\/book\/([a-z0-9]+)/i);
  if (m?.[1]) return m[1].toLowerCase();

  // .../b/CODE  (https://programari.expo.app/b/abc123)
  m = value.match(/\/b\/([a-z0-9]+)(?:\?|#|$|\/)/i);
  if (m?.[1]) return m[1].toLowerCase();

  // bare code
  if (/^[a-z0-9]{6,20}$/i.test(value)) return value.toLowerCase();

  return null;
}
