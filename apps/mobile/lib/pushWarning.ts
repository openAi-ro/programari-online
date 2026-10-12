import { trKey } from './i18n';

/** Mesaj pentru client când popup-urile push nu pot ajunge. Pur — testabil în node. */

export type PushWarning = {
  title: string;
  description: string;
  /** 'settings' = poate repara din setările telefonului; 'install' = trebuie APK real. */
  action: 'settings' | 'install' | null;
};

export function pushWarningForResult(input: {
  token: string | null;
  reason?: string;
}): PushWarning | null {
  if (input.token) return null;
  const reason = input.reason ?? '';
  if (reason === 'simulator') return null;
  if (reason === 'permission_denied') {
    return {
      title: trKey('push.deniedTitle'),
      description: trKey('push.deniedDesc'),
      action: 'settings',
    };
  }
  if (
    reason === 'web_unsupported' ||
    reason === 'expo_go_no_remote_push' ||
    reason.includes('Expo Go')
  ) {
    return {
      title: trKey('push.installTitle'),
      description: trKey('push.installDesc'),
      action: 'install',
    };
  }
  return {
    title: trKey('push.offTitle'),
    description: trKey('push.offDesc'),
    action: null,
  };
}
