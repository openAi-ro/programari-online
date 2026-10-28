import { translateTo, type AppLanguage } from './i18n';
import { normalizePhoneE164 } from './phone';

/** Limite aliniate cu migrarea v60 (check-uri în DB). */
export const MAX_DESCRIPTION_LENGTH = 1500;
export const MAX_GALLERY_PHOTOS = 12;
/** Câte servicii numim în descrierea generată din șablon. */
const AUTO_DESCRIPTION_SERVICES = 5;

/** Normalizează lista din DB: fără goluri, duplicate sau spații, max 12. */
export function normalizeGalleryUrls(urls: readonly string[] | null | undefined): string[] {
  if (!urls) return [];
  const out: string[] = [];
  for (const u of urls) {
    const v = typeof u === 'string' ? u.trim() : '';
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= MAX_GALLERY_PHOTOS) break;
  }
  return out;
}

export function addGalleryUrl(urls: readonly string[], url: string): string[] {
  const base = normalizeGalleryUrls(urls);
  const v = url.trim();
  if (!v || base.includes(v) || base.length >= MAX_GALLERY_PHOTOS) return base;
  return [...base, v];
}

export function removeGalleryUrl(urls: readonly string[], url: string): string[] {
  return normalizeGalleryUrls(urls).filter((u) => u !== url);
}

/** Descrierea efectivă a paginii: ce a scris firma sau, dacă lipsește, șablonul. */
export function effectiveDescription(input: {
  description: string | null | undefined;
  name: string;
  categoryLabel?: string | null;
  city?: string | null;
  county?: string | null;
  serviceNames: readonly string[];
  lang?: AppLanguage;
}): string {
  const own = (input.description ?? '').trim();
  if (own) return own;
  return buildAutoDescription(input);
}

/**
 * Text din ȘABLON (fără AI): nume + loc + primele servicii + invitație la rezervare.
 * Fiecare propoziție apare doar dacă are date; fără date nu rămâne nimic gol.
 */
export function buildAutoDescription(input: {
  name: string;
  categoryLabel?: string | null;
  city?: string | null;
  county?: string | null;
  serviceNames: readonly string[];
  lang?: AppLanguage;
}): string {
  const lang = input.lang ?? 'ro';
  const say = (key: Parameters<typeof translateTo>[1], vars?: Parameters<typeof translateTo>[2]) =>
    translateTo(lang, key, vars);
  const parts: string[] = [];
  const name = input.name.trim();
  const city = input.city?.trim() ?? '';
  const categoryRaw = input.categoryLabel?.trim() ?? '';
  const category = categoryRaw
    ? categoryRaw.charAt(0).toLowerCase() + categoryRaw.slice(1)
    : '';
  if (name) {
    if (category && city) {
      parts.push(say('page.autoWelcomeCatCity', { name, category, city }));
    } else if (category) {
      parts.push(say('page.autoWelcomeCat', { name, category }));
    } else {
      parts.push(say('page.autoWelcome', { name }));
    }
  }

  const place = [city, input.county?.trim()].filter(Boolean).join(', ');
  // Orașul deja numit în prima propoziție nu se repetă.
  if (place && !(category && city)) parts.push(say('page.autoPlace', { place }));

  const names = input.serviceNames.map((s) => s.trim()).filter(Boolean);
  if (names.length > 0) {
    const listed = names.slice(0, AUTO_DESCRIPTION_SERVICES).join(', ');
    const suffix =
      names.length > AUTO_DESCRIPTION_SERVICES ? ` ${say('page.autoMore')}` : '';
    parts.push(say('page.autoServices', { services: `${listed}${suffix}` }));
  }

  parts.push(say('page.autoCta'));
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pagina de prezentare e activă? Doar `false` explicit o oprește:
 * rândurile vechi (null/lipsă) rămân vizibile. Când e oprită, pagina /b
 * arată doar formularul de programare — rezervările nu se opresc niciodată.
 */
export function presentationEnabled(
  websiteEnabled: boolean | null | undefined
): boolean {
  return websiteEnabled !== false;
}

/** Coperta folosită în descoperire (carusel): ascunsă când prezentarea e oprită. */
export function visibleCoverUrl(input: {
  cover_url: string | null | undefined;
  website_enabled: boolean | null | undefined;
}): string | null {
  if (!presentationEnabled(input.website_enabled)) return null;
  const v = (input.cover_url ?? '').trim();
  return v ? v : null;
}

/** Link de apel pentru telefonul public al firmei, sau null dacă nu e un număr utilizabil. */
export function telUrl(contactPhone: string | null | undefined): string | null {
  const e164 = normalizePhoneE164(contactPhone);
  return e164 ? `tel:${e164}` : null;
}

/** Link WhatsApp (wa.me) pentru același număr public, sau null. */
export function whatsAppUrl(contactPhone: string | null | undefined): string | null {
  const e164 = normalizePhoneE164(contactPhone);
  return e164 ? `https://wa.me/${e164.slice(1)}` : null;
}
