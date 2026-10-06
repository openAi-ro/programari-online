/** Puncte de hartă persistate local: pinul rămâne vizibil după restart. */

export type MapPoint = {
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  businessName?: string | null;
  person?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  address?: string | null;
  services?: string | null;
  workHours?: string | null;
  notes?: string | null;
  photoPath?: string | null;
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MapPointInput = Pick<MapPoint, 'latitude' | 'longitude' | 'title'> &
  Partial<Omit<MapPoint, 'id' | 'latitude' | 'longitude' | 'title' | 'createdAt' | 'updatedAt'>>;

export type MapPointStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export const MAP_POINTS_KEY = 'expo.map.points.v1';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `mp_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function isValidCoords(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export async function loadPoints(storage: MapPointStorage): Promise<MapPoint[]> {
  const raw = await storage.getItem(MAP_POINTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MapPoint[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && isValidCoords(p.latitude, p.longitude));
  } catch {
    return [];
  }
}

async function saveAll(storage: MapPointStorage, points: MapPoint[]): Promise<void> {
  await storage.setItem(MAP_POINTS_KEY, JSON.stringify(points));
}

export async function upsertPoint(
  storage: MapPointStorage,
  input: MapPointInput & { id?: string }
): Promise<MapPoint> {
  if (!isValidCoords(input.latitude, input.longitude)) {
    throw new Error('Coordonate invalide.');
  }
  const title = input.title.trim();
  if (!title) throw new Error('Titlul punctului e obligatoriu.');
  const points = await loadPoints(storage);
  const stamp = nowIso();
  const byExternal = input.externalId
    ? points.findIndex((p) => p.externalId && p.externalId === input.externalId)
    : -1;
  const byId = input.id ? points.findIndex((p) => p.id === input.id) : -1;
  const idx = byId >= 0 ? byId : byExternal;
  if (idx >= 0) {
    const updated: MapPoint = {
      ...points[idx],
      ...input,
      title,
      updatedAt: stamp,
    };
    points[idx] = updated;
    await saveAll(storage, points);
    return updated;
  }
  const created: MapPoint = {
    id: input.id ?? newId(),
    latitude: input.latitude,
    longitude: input.longitude,
    title,
    businessName: input.businessName ?? null,
    person: input.person ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    website: input.website ?? null,
    address: input.address ?? null,
    services: input.services ?? null,
    workHours: input.workHours ?? null,
    notes: input.notes ?? null,
    photoPath: input.photoPath ?? null,
    externalId: input.externalId ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
  points.push(created);
  await saveAll(storage, points);
  return created;
}

export async function removePoint(storage: MapPointStorage, id: string): Promise<MapPoint[]> {
  const points = await loadPoints(storage);
  const next = points.filter((p) => p.id !== id);
  await saveAll(storage, next);
  return next;
}
