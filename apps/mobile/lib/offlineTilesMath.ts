/** Matematică pură pentru pachetul offline (fără dependențe native — testabil în node). */

export const RO_BBOX = {
  minLon: 20.2,
  minLat: 43.4,
  maxLon: 30.2,
  maxLat: 48.3,
};

export const MIN_ZOOM = 6;
export const MAX_ZOOM = 9;

export const PACK_DIR_NAME = 'offline-tiles-ro';
export const TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return { x, y };
}

export function tileRangeForBbox(
  bbox: typeof RO_BBOX,
  z: number
): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const a = lonLatToTile(bbox.minLon, bbox.maxLat, z);
  const b = lonLatToTile(bbox.maxLon, bbox.minLat, z);
  const n = 2 ** z;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, v));
  return {
    xMin: clamp(Math.min(a.x, b.x)),
    xMax: clamp(Math.max(a.x, b.x)),
    yMin: clamp(Math.min(a.y, b.y)),
    yMax: clamp(Math.max(a.y, b.y)),
  };
}

export function tileUrl(z: number, x: number, y: number): string {
  return TILE_URL_TEMPLATE.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

export function packTileCount(): number {
  let total = 0;
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
    const r = tileRangeForBbox(RO_BBOX, z);
    total += (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
  }
  return total;
}

/** Cale relativă la document dir, folosită de Leaflet cu baseUrl = document dir. */
export function tileRelPath(z: number, x: number, y: number): string {
  return `${PACK_DIR_NAME}/${z}/${x}/${y}.png`;
}
