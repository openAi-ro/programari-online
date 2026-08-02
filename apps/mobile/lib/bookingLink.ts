import * as Linking from 'expo-linking';

/**
 * Link-uri pentru QR / deep link către ecranul de programare.
 *
 * - În Expo Go: Linking.createURL produce exp://.../--/book/CODE (se deschide în app)
 * - În build nativ: programari://b/CODE
 * - Camera telefonului NU deschide mereu Expo Go pentru scheme custom — pe același telefon
 *   e mai sigur butonul din app sau scannerul din app.
 */
export function getBookingPaths(publicCode: string) {
  const code = publicCode.trim().toLowerCase();
  return {
    code,
    /** Preferat în dezvoltare (Expo Go) — include host-ul Metro */
    expoUrl: Linking.createURL(`book/${code}`),
    /** Scheme app (funcționează după build APK/IPA, nu mereu în Expo Go) */
    appScheme: `programari://b/${code}`,
    /** Path intern expo-router */
    route: `/(app)/book/${code}` as const,
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

  // .../b/CODE
  m = value.match(/\/b\/([a-z0-9]+)(?:\?|#|$|\/)/i);
  if (m?.[1]) return m[1].toLowerCase();

  // bare code
  if (/^[a-z0-9]{6,20}$/i.test(value)) return value.toLowerCase();

  return null;
}
