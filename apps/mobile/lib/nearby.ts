/**
 * Caruselul „Lângă tine" de pe ecranul principal al clientului.
 * Logică pură (fără React / rețea), ca să fie testabilă.
 */

export const NEARBY_RADIUS_KM = 20;
export const NEARBY_MAX_CARDS = 10;

export type NearbyArea = { county: string | null; city: string | null };

export type NearbyCandidate = {
  name: string;
  county: string | null;
  city: string | null;
  distanceKm: number | null;
};

/** near = pe raza de 20 km; area = același județ/localitate; all = toate business-urile. */
export type NearbySelection<T> =
  | { mode: 'near'; rows: T[] }
  | { mode: 'area'; rows: T[]; label: string; byCity: boolean }
  | { mode: 'all'; rows: T[] };

/** Coordonate rotunjite la 2 zecimale (~1 km): suficient pentru 20 km, nu localizează exact. */
export function roundCoords(c: { latitude: number; longitude: number }): {
  latitude: number;
  longitude: number;
} {
  return { latitude: Math.round(c.latitude * 100) / 100, longitude: Math.round(c.longitude * 100) / 100 };
}

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isUsableArea(area: NearbyArea | null | undefined): area is NearbyArea {
  return Boolean(area && (norm(area.county) || norm(area.city)));
}

/**
 * Alege ce arată caruselul: întâi raza (sortat după distanță), apoi zona aleasă
 * (localitate, apoi județ), apoi toate. Niciodată o listă goală dacă există business-uri.
 */
export function selectNearby<T extends NearbyCandidate>(
  rows: T[],
  area: NearbyArea | null,
  opts: { radiusKm?: number; max?: number } = {}
): NearbySelection<T> {
  const radius = opts.radiusKm ?? NEARBY_RADIUS_KM;
  const max = opts.max ?? NEARBY_MAX_CARDS;

  const near = rows
    .filter((r) => r.distanceKm != null && Number.isFinite(r.distanceKm) && r.distanceKm <= radius)
    .sort((a, b) => (a.distanceKm as number) - (b.distanceKm as number));
  if (near.length > 0) return { mode: 'near', rows: near.slice(0, max) };

  if (isUsableArea(area)) {
    const city = norm(area.city);
    const county = norm(area.county);
    if (city) {
      const inCity = rows.filter((r) => norm(r.city) === city);
      if (inCity.length > 0) return { mode: 'area', rows: inCity.slice(0, max), label: area.city!.trim(), byCity: true };
    }
    if (county) {
      const inCounty = rows.filter((r) => norm(r.county) === county);
      if (inCounty.length > 0) {
        return { mode: 'area', rows: inCounty.slice(0, max), label: area.county!.trim(), byCity: false };
      }
    }
  }

  return { mode: 'all', rows: rows.slice(0, max) };
}
