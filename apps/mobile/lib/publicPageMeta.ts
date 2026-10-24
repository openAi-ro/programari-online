/**
 * Meta (titlu, descriere, canonical, Open Graph, Twitter), JSON-LD și sitemap pentru pagina
 * publică /b/<cod>. Modul pur, fără React Native: rulează în bundle-ul de server
 * (generateMetadata, sitemap.xml+api) și în teste tsx.
 */
import type { DayKey, WorkingHours } from './types';

export const SITE_NAME = 'Programări';
export const DEFAULT_ORIGIN = 'https://programari.expo.app';
export const GENERIC_TITLE = 'Programări online | Programări';
export const GENERIC_DESCRIPTION =
  'Programează-te online la saloane, frizerii și clinici: vezi serviciile, prețurile și orele libere.';
const DESCRIPTION_MAX = 160;

/** Doar câmpuri publice (aceleași pe care le afișează pagina). */
export const PUBLIC_BUSINESS_COLUMNS =
  'id,name,public_code,description,cover_url,logo_url,gallery_urls,address,city,county,country,latitude,longitude,working_hours,contact_phone,category,website_enabled,instagram_url,facebook_url';

export type PublicBusiness = {
  id?: string;
  name: string;
  public_code: string;
  description?: string | null;
  cover_url?: string | null;
  logo_url?: string | null;
  gallery_urls?: unknown;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  country?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  working_hours?: WorkingHours | null;
  contact_phone?: string | null;
  category?: string | null;
  website_enabled?: boolean | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
};

export type PublicRating = { avg_rating: number | string | null; review_count: number } | null;

export type PublicPageMeta = {
  title: string;
  description: string;
  /** URL-ul paginii (og:url). */
  url: string;
  canonical: string;
  image: string | null;
  indexable: boolean;
  jsonLd: Record<string, unknown> | null;
};

export function normalizeOrigin(origin?: string | null): string {
  const o = (origin ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+$/i.test(o) ? o : DEFAULT_ORIGIN;
}

export function publicPageUrl(origin: string | null | undefined, code: string): string {
  return `${normalizeOrigin(origin)}/b/${encodeURIComponent(code.trim().toLowerCase())}`;
}

function clean(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

function httpUrl(v: unknown): string | null {
  const s = clean(v);
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}

export function truncate(text: string, max = DESCRIPTION_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:–-]+$/, '')}…`;
}

const SCHEMA_TYPES: Record<string, string> = {
  coafura: 'HairSalon',
  frizerie: 'HairSalon',
  cosmetica: 'BeautySalon',
  makeup: 'BeautySalon',
  epilare: 'BeautySalon',
  sprancene: 'BeautySalon',
  unghii: 'NailSalon',
  masaj: 'HealthAndBeautyBusiness',
  stomatologie: 'Dentist',
  medical: 'MedicalClinic',
  fitness: 'ExerciseGym',
  veterinar: 'VeterinaryCare',
  auto: 'AutoRepair',
};

export function schemaTypeFor(category: string | null | undefined): string {
  return (category && SCHEMA_TYPES[category]) || 'LocalBusiness';
}

const DAY_ORDER: { key: DayKey; schema: string }[] = [
  { key: 'mon', schema: 'Monday' },
  { key: 'tue', schema: 'Tuesday' },
  { key: 'wed', schema: 'Wednesday' },
  { key: 'thu', schema: 'Thursday' },
  { key: 'fri', schema: 'Friday' },
  { key: 'sat', schema: 'Saturday' },
  { key: 'sun', schema: 'Sunday' },
];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Zilele cu același interval se grupează într-o singură specificație. */
export function buildOpeningHours(hours: WorkingHours | null | undefined): Record<string, unknown>[] {
  if (!hours || typeof hours !== 'object') return [];
  const groups = new Map<string, string[]>();
  for (const { key, schema } of DAY_ORDER) {
    const d = hours[key];
    if (!d || d.closed || !HHMM.test(d.start) || !HHMM.test(d.end)) continue;
    const k = `${d.start}-${d.end}`;
    groups.set(k, [...(groups.get(k) ?? []), schema]);
  }
  return [...groups.entries()].map(([k, days]) => {
    const [opens, closes] = k.split('-');
    return { '@type': 'OpeningHoursSpecification', dayOfWeek: days, opens, closes };
  });
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function buildJsonLd(
  business: PublicBusiness,
  rating: PublicRating | undefined,
  url: string,
  description: string,
  image: string | null
): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': schemaTypeFor(business.category),
    name: clean(business.name),
    url,
    description,
  };
  if (image) ld.image = image;
  const phone = clean(business.contact_phone);
  if (phone) ld.telephone = phone;
  const street = clean(business.address);
  const city = clean(business.city);
  const county = clean(business.county);
  if (street || city) {
    ld.address = {
      '@type': 'PostalAddress',
      ...(street ? { streetAddress: street } : {}),
      ...(city ? { addressLocality: city } : {}),
      ...(county ? { addressRegion: county } : {}),
      addressCountry: clean(business.country) || 'RO',
    };
  }
  const lat = num(business.latitude);
  const lng = num(business.longitude);
  if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) {
    ld.geo = { '@type': 'GeoCoordinates', latitude: lat, longitude: lng };
  }
  const hours = buildOpeningHours(business.working_hours);
  if (hours.length > 0) ld.openingHoursSpecification = hours;
  const count = Number(rating?.review_count ?? 0);
  const avg = num(rating?.avg_rating);
  if (count > 0 && avg !== null && avg > 0) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Math.round(avg * 10) / 10,
      reviewCount: count,
      bestRating: 5,
      worstRating: 1,
    };
  }
  const sameAs = [httpUrl(business.instagram_url), httpUrl(business.facebook_url)].filter(
    (u): u is string => !!u
  );
  if (sameAs.length > 0) ld.sameAs = sameAs;
  return ld;
}

/**
 * Salon lipsă sau cu pagina de prezentare oprită -> meta generice + noindex
 * (nu expunem nimic despre un salon care nu vrea pagină publică).
 */
export function buildPublicPageMeta({
  business,
  rating,
  origin,
  code,
}: {
  business: PublicBusiness | null | undefined;
  rating?: PublicRating;
  origin?: string | null;
  code?: string | null;
}): PublicPageMeta {
  const base = normalizeOrigin(origin);
  const name = clean(business?.name);
  if (!business || business.website_enabled === false || !name || !clean(business.public_code)) {
    return {
      title: GENERIC_TITLE,
      description: GENERIC_DESCRIPTION,
      url: code ? publicPageUrl(base, code) : `${base}/`,
      canonical: `${base}/`,
      image: null,
      indexable: false,
      jsonLd: null,
    };
  }
  const url = publicPageUrl(base, business.public_code);
  const city = clean(business.city);
  const title = `${name}${city ? ` – ${city}` : ''} | Programare online`;
  const own = clean(business.description);
  const description = truncate(
    own ||
      `Programează-te online la ${name}${city ? `, ${city}` : ''}. Vezi serviciile, prețurile și orele libere.`
  );
  const gallery = Array.isArray(business.gallery_urls) ? business.gallery_urls : [];
  const image =
    httpUrl(business.cover_url) ?? httpUrl(business.logo_url) ?? httpUrl(gallery[0]) ?? null;
  return {
    title,
    description,
    url,
    canonical: url,
    image,
    indexable: true,
    jsonLd: buildJsonLd(business, rating, url, description, image),
  };
}

/** Forma `Metadata` din expo-server (generateMetadata). */
export function toExpoMetadata(meta: PublicPageMeta) {
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.canonical },
    robots: { index: meta.indexable, follow: true },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url: meta.url,
      siteName: SITE_NAME,
      locale: 'ro_RO',
      type: 'website',
      ...(meta.image ? { images: [{ url: meta.image, alt: meta.title }] } : {}),
    },
    twitter: {
      card: meta.image ? ('summary_large_image' as const) : ('summary' as const),
      title: meta.title,
      description: meta.description,
      ...(meta.image ? { images: [meta.image] } : {}),
    },
  };
}

/** JSON sigur în <script type="application/ld+json"> (fără `</script>` injectabil). */
export function jsonLdText(jsonLd: Record<string, unknown> | null): string | null {
  if (!jsonLd) return null;
  return JSON.stringify(jsonLd).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildSitemapXml(
  origin: string | null | undefined,
  rows: { public_code: string | null }[]
): string {
  const base = normalizeOrigin(origin);
  const seen = new Set<string>();
  const urls = [`${base}/`];
  for (const r of rows) {
    const code = clean(r.public_code).toLowerCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    urls.push(publicPageUrl(base, code));
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${xmlEscape(u)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
}
