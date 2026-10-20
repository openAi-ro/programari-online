import AsyncStorage from '@react-native-async-storage/async-storage';

import type { NearbyArea } from './nearby';

/**
 * Preferințele caruselului „Lângă tine”, doar pe dispozitiv.
 * Păstrăm DOAR alegerea (locație permisă da/nu) și zona aleasă manual — niciodată coordonate.
 */
export type NearbyPrefs = { locationAllowed: boolean; area: NearbyArea | null };

const KEY = 'programari.nearby.v1';

export async function loadNearbyPrefs(): Promise<NearbyPrefs> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<NearbyPrefs>) : {};
    const a = v.area;
    return {
      locationAllowed: v.locationAllowed === true,
      area:
        a && (typeof a.county === 'string' || typeof a.city === 'string')
          ? { county: typeof a.county === 'string' ? a.county : null, city: typeof a.city === 'string' ? a.city : null }
          : null,
    };
  } catch {
    return { locationAllowed: false, area: null };
  }
}

export async function saveNearbyPrefs(next: NearbyPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ locationAllowed: next.locationAllowed, area: next.area }));
  } catch {
    // stocare indisponibilă (mod privat): caruselul merge și fără preferințe salvate
  }
}
