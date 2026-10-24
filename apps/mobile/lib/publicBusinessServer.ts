/**
 * Citiri publice pentru server (generateMetadata, sitemap.xml): REST Supabase cu cheia anon,
 * deci exact ce vede un vizitator nelogat (RLS se aplică). Doar coloane publice, cu timeout;
 * orice eroare -> null (pagina primește meta generice, nu cade).
 */
import {
  PUBLIC_BUSINESS_COLUMNS,
  buildPublicPageMeta,
  normalizeOrigin,
  toExpoMetadata,
  type PublicBusiness,
  type PublicRating,
} from './publicPageMeta';

const TIMEOUT_MS = 3000;
const CODE_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function publicOrigin(): string {
  return normalizeOrigin(process.env.EXPO_PUBLIC_WEB_BASE_URL);
}

async function rest<T>(path: string, init?: { method?: string; body?: string }): Promise<T | null> {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method: init?.method ?? 'GET',
      body: init?.body,
      signal: ctrl.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchPublicBusiness(code: string | undefined): Promise<PublicBusiness | null> {
  const c = (code ?? '').trim().toLowerCase();
  if (!CODE_RE.test(c)) return null;
  const rows = await rest<PublicBusiness[]>(
    `business_profiles?select=${PUBLIC_BUSINESS_COLUMNS}&public_code=eq.${encodeURIComponent(c)}&limit=1`
  );
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

export async function fetchPublicRating(businessId: string): Promise<PublicRating> {
  const data = await rest<unknown>('rpc/business_rating', {
    method: 'POST',
    body: JSON.stringify({ p_business_id: businessId }),
  });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { avg_rating?: number | string | null; review_count?: number | string | null }
    | null;
  return row ? { avg_rating: row.avg_rating ?? null, review_count: Number(row.review_count ?? 0) } : null;
}

/** Saloanele cu pagină publică (website_enabled nu e false, ca în presentationEnabled). */
export async function listSitemapBusinesses(): Promise<{ public_code: string | null }[]> {
  const rows = await rest<{ public_code: string | null }[]>(
    'business_profiles?select=public_code&website_enabled=not.is.false&public_code=not.is.null&order=public_code.asc&limit=5000'
  );
  return Array.isArray(rows) ? rows : [];
}

export async function loadPublicPageMetadata(code: string | undefined) {
  const business = await fetchPublicBusiness(code);
  const rating = business?.id ? await fetchPublicRating(business.id) : null;
  return toExpoMetadata(buildPublicPageMeta({ business, rating, origin: publicOrigin(), code }));
}
