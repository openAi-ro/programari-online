import { trKey } from './i18n';

/**
 * Erorile de rețea ale browserului / React Native („TypeError: Failed to fetch”, „Network request
 * failed”, „Load failed” pe Safari) nu se arată brut: clientul vede un singur mesaj clar
 * (retest 3.24, P5 offline).
 */
const NETWORK_ERROR =
  /failed to fetch|network ?request failed|networkerror|load failed|fetch failed|err_internet_disconnected|err_network_changed|err_name_not_resolved/i;

export function isNetworkError(message: string | null | undefined): boolean {
  return Boolean(message && NETWORK_ERROR.test(message));
}

/** Textul de afișat: mesajul de „fără internet” pentru erori de rețea, altfel mesajul primit. */
export function userFacingError(message: string): string {
  return isNetworkError(message) ? trKey('common.offline') : message;
}
