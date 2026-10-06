import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

const KEY = 'programari.favoriteBusinessIds';

type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();
let memory: string[] = [];
let hydrated = false;
let syncing = false;

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function emit(ids: string[]) {
  memory = ids;
  for (const l of listeners) {
    try {
      l(ids);
    } catch {
      /* ignore */
    }
  }
}

async function persistLocal(ids: string[]): Promise<void> {
  try {
    const raw = JSON.stringify(ids);
    if (Platform.OS === 'web') {
      webStore()?.setItem(KEY, raw);
    } else {
      await AsyncStorage.setItem(KEY, raw);
    }
  } catch {
    /* best-effort */
  }
}

export function subscribeFavorites(listener: Listener): () => void {
  listeners.add(listener);
  listener(memory);
  return () => {
    listeners.delete(listener);
  };
}

export function getFavoriteIdsSync(): string[] {
  return memory;
}

export async function getFavoriteIds(): Promise<string[]> {
  if (!hydrated) {
    try {
      let raw: string | null = null;
      if (Platform.OS === 'web') {
        raw = webStore()?.getItem(KEY) ?? null;
      } else {
        raw = await AsyncStorage.getItem(KEY);
      }
      emit(parseIds(raw));
    } catch {
      emit([]);
    }
    hydrated = true;
  }
  // Sync cloud în background (nu blochează UI)
  void syncFavoritesFromCloud();
  return memory;
}

/**
 * Încarcă favoritele din Supabase (dacă e logat) și le unește cu cache-ul local.
 * Dacă tabela v27 nu e încă pe proiect, rămânem pe local.
 */
export async function syncFavoritesFromCloud(): Promise<string[]> {
  if (syncing) return memory;
  syncing = true;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return memory;
    }

    const { data, error } = await supabase
      .from('client_favorites')
      .select('business_id')
      .eq('user_id', user.id);

    if (error) {
      // Tabelă lipsă / RLS — păstrăm local
      return memory;
    }

    const cloudIds = (data ?? [])
      .map((r) => (typeof r.business_id === 'string' ? r.business_id : null))
      .filter((x): x is string => Boolean(x));

    // Merge: cloud ∪ local, apoi împinge diferențele locale spre cloud
    const localOnly = memory.filter((id) => !cloudIds.includes(id));
    const merged = [...new Set([...cloudIds, ...memory])];

    if (localOnly.length > 0) {
      const rows = localOnly.map((business_id) => ({
        user_id: user.id,
        business_id,
      }));
      await supabase.from('client_favorites').upsert(rows, {
        onConflict: 'user_id,business_id',
        ignoreDuplicates: true,
      });
    }

    hydrated = true;
    emit(merged);
    await persistLocal(merged);
    return merged;
  } catch {
    return memory;
  } finally {
    syncing = false;
  }
}

export async function setFavoriteIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  const prev = new Set(memory);
  hydrated = true;
  emit(unique);
  await persistLocal(unique);

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const next = new Set(unique);
    const toAdd = unique.filter((id) => !prev.has(id));
    const toRemove = [...prev].filter((id) => !next.has(id));

    if (toAdd.length > 0) {
      await supabase.from('client_favorites').upsert(
        toAdd.map((business_id) => ({ user_id: user.id, business_id })),
        { onConflict: 'user_id,business_id', ignoreDuplicates: true }
      );
    }
    if (toRemove.length > 0) {
      await supabase
        .from('client_favorites')
        .delete()
        .eq('user_id', user.id)
        .in('business_id', toRemove);
    }
  } catch {
    /* best-effort cloud */
  }
}

export async function toggleFavorite(businessId: string): Promise<boolean> {
  const ids = await getFavoriteIds();
  const has = ids.includes(businessId);
  const next = has ? ids.filter((id) => id !== businessId) : [...ids, businessId];
  await setFavoriteIds(next);
  return !has;
}

export function isFavoriteSync(businessId: string): boolean {
  return memory.includes(businessId);
}

/** Încarcă profilele publice pentru o listă de favorite (rebook / Acasă). */
export async function loadFavoriteBusinesses(
  ids: string[]
): Promise<
  {
    id: string;
    name: string;
    public_code: string;
    city: string | null;
    logo_url: string | null;
  }[]
> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('business_profiles')
    .select('id, name, public_code, city, logo_url')
    .in('id', ids);
  if (error || !data) return [];
  const byId = new Map(data.map((b) => [b.id as string, b]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((b) => ({
      id: b!.id as string,
      name: b!.name as string,
      public_code: b!.public_code as string,
      city: (b!.city as string | null) ?? null,
      logo_url: (b!.logo_url as string | null) ?? null,
    }));
}
