import { getLanguageSync } from './language';

/**
 * Limba trimisă funcției e doar o rezervă pentru clientul fără cont (cei cu cont primesc limba
 * din profil, pe server). Limba dispozitivului contează doar când acționează chiar clientul;
 * când acționează salonul, invitatul primește româna implicită, nu limba browserului salonului
 * (F-A, retest 3.24, TypeSafe e3: 0,70).
 */
export function notifyLangFor(sentBy: 'client' | 'business'): string | undefined {
  return sentBy === 'client' ? getLanguageSync() : undefined;
}
