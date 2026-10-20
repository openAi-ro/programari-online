import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { grantSignal, timeoutAfterGrant } from '@/lib/locateTiming';
import { withTimeout } from '@/lib/withTimeout';
import type { WorkingHours } from '@/lib/types';
import { localeTag, trKey } from './i18n';

export type PublicBusiness = {
  id: string;
  name: string;
  public_code: string;
  city: string | null;
  county: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  logo_url: string | null;
  maps_url: string | null;
  avg_rating: number | null;
  review_count: number;
  working_hours: WorkingHours | null;
  /** Timezone IANA (dupa migrarea v33 pe RPC; mereu pe fallback SELECT). */
  timezone: string | null;
  promo_video_url: string | null;
  /** Cheie categorie browse (BROWSE_CATEGORIES.key). */
  category: string | null;
  /** Cod ISO tara; implicit 'RO' pentru randurile vechi. */
  country: string | null;
};

export type ListPublicBusinessesOpts = {
  q?: string;
  /** Localitate / oraș (business_profiles.city). */
  city?: string;
  /** Județ (business_profiles.county). */
  county?: string;
  limit?: number;
  /** Filtru server pe business_profiles.category (necesită migrarea v30). */
  category?: string;
};

const GEO_TIMEOUT_MS = 15000;
/** Poziție din cache acceptată pentru locația aproximativă. */
const CACHED_POSITION_MAX_AGE_MS = 10 * 60000;

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function isWorkingHours(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return DAY_KEYS.every((k) => typeof r[k] === 'object' && r[k] !== null);
}

function normalizeRow(raw: Record<string, unknown>): PublicBusiness | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  const public_code = typeof raw.public_code === 'string' ? raw.public_code : null;
  if (!id || !name || !public_code) return null;
  return {
    id,
    name,
    public_code,
    city: typeof raw.city === 'string' ? raw.city : null,
    county: typeof raw.county === 'string' ? raw.county : null,
    address: typeof raw.address === 'string' ? raw.address : null,
    latitude: asNumber(raw.latitude),
    longitude: asNumber(raw.longitude),
    logo_url: typeof raw.logo_url === 'string' ? raw.logo_url : null,
    working_hours: isWorkingHours(raw.working_hours) ? (raw.working_hours as WorkingHours) : null,
    timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : null,
    promo_video_url: typeof raw.promo_video_url === 'string' ? raw.promo_video_url : null,
    category: typeof raw.category === 'string' ? raw.category : null,
    country: typeof raw.country === 'string' ? raw.country : null,
    maps_url: typeof raw.maps_url === 'string' ? raw.maps_url : null,
    avg_rating: asNumber(raw.avg_rating),
    review_count:
      typeof raw.review_count === 'number'
        ? raw.review_count
        : typeof raw.review_count === 'string'
          ? Number(raw.review_count) || 0
          : 0,
  };
}

/**
 * Listă publică pentru descoperire.
 * Prefers RPC list_public_businesses (v26); fallback pe SELECT direct (RLS actual permite).
 */
export async function listPublicBusinesses(
  opts: ListPublicBusinessesOpts = {}
): Promise<{ rows: PublicBusiness[]; source: 'rpc' | 'select'; error: string | null }> {
  const q = opts.q?.trim() || null;
  const city = opts.city?.trim() || null;
  const county = opts.county?.trim() || null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);

  // RPC v26: p_q + p_city (city OR county). Trimitem localitatea în p_city;
  // județul se aplică client-side după RPC (fără migrare nouă).
  const rpcCity = city || null;

  const rpc = await supabase.rpc('list_public_businesses', {
    p_q: q,
    p_city: rpcCity,
    p_limit: limit,
  });

  if (!rpc.error && Array.isArray(rpc.data)) {
    let rows = (rpc.data as Record<string, unknown>[])
      .map(normalizeRow)
      .filter((r): r is PublicBusiness => r != null);
    if (county) {
      const needle = county.toLowerCase();
      rows = rows.filter((r) => (r.county ?? '').toLowerCase() === needle);
    }
    if (city) {
      const needle = city.toLowerCase();
      rows = rows.filter((r) => (r.city ?? '').toLowerCase().includes(needle));
    }
    return { rows, source: 'rpc', error: null };
  }

  // Fallback: SELECT pe câmpuri publice (merge pe live fără migrarea v26).
  let query = supabase
    .from('business_profiles')
    .select('id, name, public_code, city, county, address, latitude, longitude, logo_url, maps_url, working_hours, timezone, promo_video_url, category, country')
    .order('name', { ascending: true })
    .limit(limit);

  if (q) {
    query = query.or(`name.ilike.%${q}%,public_code.ilike.%${q}%`);
  }
  if (city) {
    query = query.ilike('city', `%${city}%`);
  }
  if (county) {
    query = query.ilike('county', county);
  }

  let selectResult = await query;
  if (selectResult.error && /category|country/i.test(selectResult.error.message)) {
    let retry = supabase
      .from('business_profiles')
      .select('id, name, public_code, city, county, address, latitude, longitude, logo_url, maps_url, working_hours, timezone, promo_video_url, country')
      .order('name', { ascending: true })
      .limit(limit);
    if (q) {
      retry = retry.or(`name.ilike.%${q}%,public_code.ilike.%${q}%`);
    }
    if (city) {
      retry = retry.ilike('city', `%${city}%`);
    }
    if (county) {
      retry = retry.ilike('county', county);
    }
    selectResult = (await retry) as typeof selectResult;
  }
  if (selectResult.error && /promo_video_url|working_hours|country/i.test(selectResult.error.message)) {
    let retry = supabase
      .from('business_profiles')
      .select('id, name, public_code, city, county, address, latitude, longitude, logo_url, maps_url, timezone')
      .order('name', { ascending: true })
      .limit(limit);
    if (q) {
      retry = retry.or(`name.ilike.%${q}%,public_code.ilike.%${q}%`);
    }
    if (city) {
      retry = retry.ilike('city', `%${city}%`);
    }
    if (county) {
      retry = retry.ilike('county', county);
    }
    selectResult = (await retry) as typeof selectResult;
  }
  const { data, error } = selectResult;
  if (error) {
    return { rows: [], source: 'select', error: error.message };
  }

  let rows = ((data ?? []) as Record<string, unknown>[])
    .map((r) => normalizeRow({ ...r, avg_rating: null, review_count: 0 }))
    .filter((r): r is PublicBusiness => r != null);

  if (county) {
    const needle = county.toLowerCase();
    rows = rows.filter((r) => (r.county ?? '').toLowerCase() === needle);
  }
  if (city) {
    const needle = city.toLowerCase();
    rows = rows.filter((r) => (r.city ?? '').toLowerCase().includes(needle));
  }

  return { rows, source: 'select', error: null };
}

/** Distanță haversine în km. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistanceKm(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  // „3,2 km” în română, „3.2 km” în engleză.
  if (km < 10) {
    return `${km.toLocaleString(localeTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }
  return `${Math.round(km)} km`;
}

export function formatBizHint(
  biz: PublicBusiness,
  opts?: { distanceKm?: number | null }
): string {
  const parts: string[] = [];
  const place = [biz.city, biz.county].filter(Boolean).join(', ');
  if (place) parts.push(place);
  if (biz.avg_rating != null && biz.review_count > 0) {
    parts.push(`★ ${biz.avg_rating.toFixed(1)} (${biz.review_count})`);
  }
  const dist = formatDistanceKm(opts?.distanceKm ?? null);
  if (dist) parts.push(dist);
  if (!place && biz.public_code) parts.push(biz.public_code);
  return parts.join(" · ");
}

export type DeviceCoords = { latitude: number; longitude: number };

export type DeviceCoordsOptions = {
  /** Locație aproximativă (fără GPS precis): rețea / celule, mai rapidă. */
  approximate?: boolean;
  timeoutMs?: number;
};

/**
 * Locația dispozitivului — web: navigator.geolocation; native: expo-location.
 * Timeout-ul (implicit 15 s) pornește abia după ce permisiunea e acordată:
 * timpul petrecut în dialogul de permisiune nu se numără.
 * `approximate`: precizie redusă și poziție recentă din cache (max 10 min).
 */
export async function getDeviceCoords(opts: DeviceCoordsOptions = {}): Promise<DeviceCoords> {
  const timeoutMs = opts.timeoutMs ?? GEO_TIMEOUT_MS;
  if (Platform.OS === 'web') {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      throw new Error('location_unavailable');
    }
    const perms = navigator.permissions;
    const signal = grantSignal(
      perms?.query ? () => perms.query({ name: 'geolocation' as PermissionName }) : null
    );
    try {
      // Timeout-ul nativ (options.timeout) nu include dialogul de permisiune; timer-ul de
      // siguranță pentru browserele care nu-l respectă pornește tot doar după acordare.
      return await timeoutAfterGrant(
        new Promise<DeviceCoords>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
            (err) =>
              reject(
                new Error(
                  err.code === err.PERMISSION_DENIED
                    ? 'permission_denied'
                    : err.code === err.TIMEOUT
                      ? 'location_timeout'
                      : 'location_failed'
                )
              ),
            {
              enableHighAccuracy: !opts.approximate,
              timeout: timeoutMs,
              maximumAge: opts.approximate ? CACHED_POSITION_MAX_AGE_MS : 60000,
            }
          );
        }),
        signal.granted,
        timeoutMs + 2000
      );
    } finally {
      signal.dispose();
    }
  }

  const Location = await import('expo-location');
  // Fără timeout: dialogul de permisiune așteaptă răspunsul utilizatorului.
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('permission_denied');

  if (opts.approximate) {
    const last = await Location.getLastKnownPositionAsync({ maxAge: CACHED_POSITION_MAX_AGE_MS }).catch(
      () => null
    );
    if (last) return { latitude: last.coords.latitude, longitude: last.coords.longitude };
  }

  const pos = await withTimeout(
    Location.getCurrentPositionAsync({
      accuracy: opts.approximate ? Location.Accuracy.Low : Location.Accuracy.Balanced,
    }),
    timeoutMs,
    'location_timeout'
  );
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

/**
 * Permisiunea de locație e deja acordată? Nu afișează niciun dialog
 * (web: Permissions API; nativ: getForegroundPermissionsAsync).
 */
export async function hasGrantedLocation(): Promise<boolean> {
  try {
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) return false;
      const st = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      return st.state === 'granted';
    }
    const Location = await import('expo-location');
    const { status } = await Location.getForegroundPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export function locationErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : String(err ?? '');
  switch (code) {
    case 'permission_denied':
      return trKey('loc.errDenied');
    case 'location_timeout':
    case 'permission_timeout':
      return trKey('loc.errTimeout');
    case 'location_unavailable':
      return trKey('loc.errUnavailable');
    case 'location_failed':
      return trKey('loc.errFailed');
    default:
      return trKey('loc.errDefault');
  }
}

export type PublicBusinessWithDistance = PublicBusiness & {
  distanceKm: number | null;
};

/** Sortează: întâi cu coordonate (crescător după distanță), apoi restul alfabetic. */
export function withDistances(
  rows: PublicBusiness[],
  coords: DeviceCoords | null
): PublicBusinessWithDistance[] {
  const mapped: PublicBusinessWithDistance[] = rows.map((r) => {
    let distanceKm: number | null = null;
    if (
      coords &&
      typeof r.latitude === 'number' &&
      typeof r.longitude === 'number' &&
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude)
    ) {
      distanceKm = haversineKm(coords.latitude, coords.longitude, r.latitude, r.longitude);
    }
    return { ...r, distanceKm };
  });

  mapped.sort((a, b) => {
    const aHas = a.distanceKm != null;
    const bHas = b.distanceKm != null;
    if (aHas && bHas) return (a.distanceKm as number) - (b.distanceKm as number);
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    return a.name.localeCompare(b.name, 'ro');
  });
  return mapped;
}

export function uniqueCities(rows: PublicBusiness[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const c = r.city?.trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ro'));
}

/** Județe distincte din business_profiles.county (câmp existent). */
export function uniqueCounties(rows: PublicBusiness[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const c = r.county?.trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ro'));
}

/**
 * Localități distincte din business_profiles.city.
 * Dacă `county` e setat, doar localitățile din acel județ.
 */
export function uniqueLocalities(
  rows: PublicBusiness[],
  county?: string | null
): string[] {
  const set = new Set<string>();
  const countyNeedle = county?.trim().toLowerCase() || null;
  for (const r of rows) {
    if (countyNeedle && (r.county ?? '').toLowerCase() !== countyNeedle) continue;
    const c = r.city?.trim();
    if (c) set.add(c);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ro'));
}
