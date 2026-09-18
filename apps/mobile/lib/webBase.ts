import Constants from 'expo-constants';

const FALLBACK_PUBLIC_WEB_ORIGIN = 'https://programari.expo.app';

type Extra = { webBaseUrl?: string };

function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (host.endsWith('.local') || host.includes('exp.direct')) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) {
    return true;
  }
  return false;
}

function publicHttpsOrigin(value: string | undefined): string | null {
  const raw = value?.replace(/\/$/, '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (/^https?:$/i.test(parsed.protocol) && !isPrivateOrLocalHost(parsed.hostname)) {
      return raw;
    }
  } catch {
    return null;
  }
  return null;
}

/** Public https origin. Never localhost / LAN / Expo Go — QR and emails must work off this PC. */
export function getPublicWebOrigin(): string {
  const fromEnv = publicHttpsOrigin(process.env.EXPO_PUBLIC_WEB_BASE_URL);
  if (fromEnv) return fromEnv;

  const extra = Constants.expoConfig?.extra as Extra | undefined;
  const fromExtra = publicHttpsOrigin(extra?.webBaseUrl);
  if (fromExtra) return fromExtra;

  return FALLBACK_PUBLIC_WEB_ORIGIN;
}
