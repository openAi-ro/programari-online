/**
 * Cele 30 de tari suportate pentru locatie / cautare / fus orar:
 * UE-27 + Marea Britanie + Moldova + Turcia.
 * timezone = fusul capitalei (un fus canonic per tara).
 */
export type Country = {
  /** Cod ISO 3166-1 alpha-2, salvat in business_profiles.country. */
  code: string;
  nameRo: string;
  nameEn: string;
  timezone: string;
};

export const COUNTRIES: Country[] = [
  { code: 'RO', nameRo: 'România', nameEn: 'Romania', timezone: 'Europe/Bucharest' },
  { code: 'AT', nameRo: 'Austria', nameEn: 'Austria', timezone: 'Europe/Vienna' },
  { code: 'BE', nameRo: 'Belgia', nameEn: 'Belgium', timezone: 'Europe/Brussels' },
  { code: 'BG', nameRo: 'Bulgaria', nameEn: 'Bulgaria', timezone: 'Europe/Sofia' },
  { code: 'HR', nameRo: 'Croația', nameEn: 'Croatia', timezone: 'Europe/Zagreb' },
  { code: 'CY', nameRo: 'Cipru', nameEn: 'Cyprus', timezone: 'Europe/Nicosia' },
  { code: 'CZ', nameRo: 'Cehia', nameEn: 'Czechia', timezone: 'Europe/Prague' },
  { code: 'DK', nameRo: 'Danemarca', nameEn: 'Denmark', timezone: 'Europe/Copenhagen' },
  { code: 'EE', nameRo: 'Estonia', nameEn: 'Estonia', timezone: 'Europe/Tallinn' },
  { code: 'FI', nameRo: 'Finlanda', nameEn: 'Finland', timezone: 'Europe/Helsinki' },
  { code: 'FR', nameRo: 'Franța', nameEn: 'France', timezone: 'Europe/Paris' },
  { code: 'DE', nameRo: 'Germania', nameEn: 'Germany', timezone: 'Europe/Berlin' },
  { code: 'GR', nameRo: 'Grecia', nameEn: 'Greece', timezone: 'Europe/Athens' },
  { code: 'HU', nameRo: 'Ungaria', nameEn: 'Hungary', timezone: 'Europe/Budapest' },
  { code: 'IE', nameRo: 'Irlanda', nameEn: 'Ireland', timezone: 'Europe/Dublin' },
  { code: 'IT', nameRo: 'Italia', nameEn: 'Italy', timezone: 'Europe/Rome' },
  { code: 'LV', nameRo: 'Letonia', nameEn: 'Latvia', timezone: 'Europe/Riga' },
  { code: 'LT', nameRo: 'Lituania', nameEn: 'Lithuania', timezone: 'Europe/Vilnius' },
  { code: 'LU', nameRo: 'Luxemburg', nameEn: 'Luxembourg', timezone: 'Europe/Luxembourg' },
  { code: 'MT', nameRo: 'Malta', nameEn: 'Malta', timezone: 'Europe/Malta' },
  { code: 'NL', nameRo: 'Olanda', nameEn: 'Netherlands', timezone: 'Europe/Amsterdam' },
  { code: 'PL', nameRo: 'Polonia', nameEn: 'Poland', timezone: 'Europe/Warsaw' },
  { code: 'PT', nameRo: 'Portugalia', nameEn: 'Portugal', timezone: 'Europe/Lisbon' },
  { code: 'SK', nameRo: 'Slovacia', nameEn: 'Slovakia', timezone: 'Europe/Bratislava' },
  { code: 'SI', nameRo: 'Slovenia', nameEn: 'Slovenia', timezone: 'Europe/Ljubljana' },
  { code: 'ES', nameRo: 'Spania', nameEn: 'Spain', timezone: 'Europe/Madrid' },
  { code: 'SE', nameRo: 'Suedia', nameEn: 'Sweden', timezone: 'Europe/Stockholm' },
  { code: 'GB', nameRo: 'Marea Britanie', nameEn: 'United Kingdom', timezone: 'Europe/London' },
  { code: 'MD', nameRo: 'Moldova', nameEn: 'Moldova', timezone: 'Europe/Chisinau' },
  { code: 'TR', nameRo: 'Turcia', nameEn: 'Turkey', timezone: 'Europe/Istanbul' },
];

export const DEFAULT_COUNTRY_CODE = 'RO';

export function countryByCode(code: string | null | undefined): Country | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code.trim().toUpperCase()) ?? null;
}

/** Tara unei programari/business; randurile vechi fara tara sunt din Romania. */
export function countryCodeOf(code: string | null | undefined): string {
  return countryByCode(code)?.code ?? DEFAULT_COUNTRY_CODE;
}

export function countryName(code: string | null | undefined, lang: 'ro' | 'en'): string {
  const c = countryByCode(countryCodeOf(code));
  if (!c) return '';
  return lang === 'en' ? c.nameEn : c.nameRo;
}

export function countryNames(lang: 'ro' | 'en'): string[] {
  return COUNTRIES.map((c) => (lang === 'en' ? c.nameEn : c.nameRo));
}

export function countryByName(name: string, lang: 'ro' | 'en'): Country | null {
  return COUNTRIES.find((c) => (lang === 'en' ? c.nameEn : c.nameRo) === name) ?? null;
}

/** Fusurile orare distincte ale celor 30 de tari (pentru selectorul din Setup). */
export const COUNTRY_TIMEZONES: string[] = [...new Set(COUNTRIES.map((c) => c.timezone))];
