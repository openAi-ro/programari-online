import { trKey } from './i18n';

/**
 * Mesajul pentru salon când acțiunea s-a salvat, dar funcția care anunță clientul a eșuat
 * (sesiune expirată, rețea, eroare de server). `null` când clientul a fost anunțat.
 */
export function clientNotifyWarning(result: { ok: boolean }): string | null {
  return result.ok ? null : trKey('req.clientNotNotified');
}
