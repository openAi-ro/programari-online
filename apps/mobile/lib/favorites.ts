import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import { getCurrentUser } from './currentUser';

/**
 * Favoritele trăiesc doar în baza de date (client_favorites, RLS per user).
 * Memoria de mai jos e doar cache-ul contului curent (`ownerId`); la schimbarea
 * contului sau la deconectare se golește, deci nu se pot scurge între conturi.
 */
type Listener = (ids: string[]) => void;
const listeners = new Set<Listener>();
let memory: string[] = [];
let ownerId: string | null = null;
let loading: Promise<string[]> | null = null;

// Vechea cheie locală comună tuturor conturilor (sursa scurgerii F-1) — o ștergem o dată.
const LEGACY_KEY = 'programari.favoriteBusinessIds';
try {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.localStorage?.removeItem(LEGACY_KEY);
  } else {
    void AsyncStorage.removeItem(LEGACY_KEY);
  }
} catch {
  /* ignore */
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

supabase.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id ?? null;
  if (uid !== ownerId) {
    ownerId = null;
    loading = null;
    emit([]);
  }
});

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

/** Recitește favoritele contului curent din baza de date. */
export async function syncFavoritesFromCloud(): Promise<string[]> {
  if (loading) return loading;
  loading = (async () => {
    const user = await getCurrentUser();
    if (!user) {
      ownerId = null;
      emit([]);
      return [];
    }
    const { data, error } = await supabase
      .from('client_favorites')
      .select('business_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });
    if (error) return ownerId === user.id ? memory : [];
    const ids = (data ?? [])
      .map((r) => (typeof r.business_id === 'string' ? r.business_id : null))
      .filter((x): x is string => Boolean(x));
    ownerId = user.id;
    emit(ids);
    return ids;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/** Favoritele contului curent (din cache dacă sunt deja încărcate pentru acest cont). */
export async function getFavoriteIds(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) {
    if (memory.length) emit([]);
    ownerId = null;
    return [];
  }
  if (ownerId === user.id) return memory;
  return syncFavoritesFromCloud();
}

/** Adaugă/scoate un salon; starea se schimbă doar după ce baza de date confirmă. */
export async function toggleFavorite(businessId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const ids = await getFavoriteIds();
  const has = ids.includes(businessId);
  const { error } = has
    ? await supabase
        .from('client_favorites')
        .delete()
        .eq('user_id', user.id)
        .eq('business_id', businessId)
    : await supabase
        .from('client_favorites')
        .upsert(
          { user_id: user.id, business_id: businessId },
          { onConflict: 'user_id,business_id', ignoreDuplicates: true }
        );
  if (error) return has;
  ownerId = user.id;
  emit(has ? memory.filter((id) => id !== businessId) : [...memory, businessId]);
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
