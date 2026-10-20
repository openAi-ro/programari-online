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

export type CarouselLayout = {
  /** Width of every card, derived from the real container width. */
  cardWidth: number;
  /** All cards are fully visible: no scrolling, no arrows. */
  fitsAll: boolean;
  /** Scroll offsets of the snap points; the last one shows the last card fully (right-aligned). */
  offsets: number[];
  contentWidth: number;
};

/**
 * Card sizing for the horizontal carousel, from the container width (onLayout).
 * - everything fits (cards between minCard and maxCard) -> show all, no scrolling;
 * - otherwise one card (or two when they fit) plus a clear `peek` of the next one;
 * - snap offsets stop at the end of the content so the last card is never clipped.
 */
export function carouselLayout(
  containerWidth: number,
  count: number,
  opts: { gap?: number; minCard?: number; maxCard?: number; peek?: number } = {}
): CarouselLayout {
  const gap = opts.gap ?? 12;
  const minCard = opts.minCard ?? 200;
  const maxCard = opts.maxCard ?? 300;
  const peek = opts.peek ?? 48;
  const w = Math.max(0, Math.floor(containerWidth));
  const n = Math.max(0, Math.floor(count));
  if (w === 0 || n === 0) return { cardWidth: Math.min(maxCard, 260), fitsAll: n <= 1, offsets: [0], contentWidth: 0 };

  const share = Math.floor((w - gap * (n - 1)) / n);
  if (share >= minCard) {
    const cardWidth = Math.min(maxCard, share);
    return { cardWidth, fitsAll: true, offsets: [0], contentWidth: n * cardWidth + gap * (n - 1) };
  }

  const twoWithPeek = Math.floor((w - 2 * gap - peek) / 2);
  const cardWidth = Math.max(
    1,
    Math.min(maxCard, twoWithPeek >= minCard ? twoWithPeek : w - gap - peek)
  );
  const contentWidth = n * cardWidth + gap * (n - 1);
  const maxOffset = Math.max(0, contentWidth - w);
  const offsets: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * (cardWidth + gap);
    if (o >= maxOffset) break;
    offsets.push(o);
  }
  offsets.push(maxOffset);
  return { cardWidth, fitsAll: maxOffset === 0, offsets, contentWidth };
}

/** Index of the snap offset closest to the current scroll position. */
export function nearestOffsetIndex(offsets: readonly number[], x: number): number {
  let best = 0;
  for (let i = 1; i < offsets.length; i++) {
    if (Math.abs(offsets[i] - x) < Math.abs(offsets[best] - x)) best = i;
  }
  return best;
}
