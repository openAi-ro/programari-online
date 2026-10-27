import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { getBookingPaths } from './bookingLink';
import { trKey } from './i18n';

/**
 * Partajarea linkului public al salonului — o singură implementare pentru ecranul QR
 * și pagina publică /b/<cod>.
 * - mobil: foaia nativă Share
 * - web: navigator.share unde există, altfel copiere în clipboard
 */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed';

type Shareable = { name: string; public_code: string };

export function businessShareTitle(name: string): string {
  return trKey('qr.shareMsg').replace('{name}', name);
}

export async function copyBusinessLink(publicCode: string): Promise<string> {
  const url = getBookingPaths(publicCode).webUrl;
  await Clipboard.setStringAsync(url);
  return url;
}

/** Partajează un text (invitație, programare); pe web fără Web Share îl copiază în clipboard. */
export async function shareText(message: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ text: message });
        return 'shared';
      } catch (e) {
        if ((e as { name?: string } | null)?.name === 'AbortError') return 'dismissed';
      }
    }
    await Clipboard.setStringAsync(message);
    return 'copied';
  }
  const res = await Share.share({ message });
  return res.action === Share.dismissedAction ? 'dismissed' : 'shared';
}

export async function shareBusinessLink(business: Shareable): Promise<ShareOutcome> {
  const url = getBookingPaths(business.public_code).webUrl;
  const title = businessShareTitle(business.name);
  if (Platform.OS === 'web') {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title, text: title, url });
        return 'shared';
      } catch (e) {
        if ((e as { name?: string } | null)?.name === 'AbortError') return 'dismissed';
        // Alt eșec (ex. permisiune) -> copiem linkul.
      }
    }
    await Clipboard.setStringAsync(url);
    return 'copied';
  }
  const res = await Share.share({ message: `${title}\n${url}`, url, title });
  return res.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
