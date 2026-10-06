import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/** system = ca pe telefon; light/dark = forțat în app. */
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'programari.themePreference';

type Listener = (pref: ThemePreference) => void;
const listeners = new Set<Listener>();
let memory: ThemePreference = 'system';
let hydrated = false;

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parsePref(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/**
 * Actualizează preferința în memorie și anunță UI-ul.
 * Nu folosim Appearance.setColorScheme(null) — pe Android native crapă
 * („Parameter specified as non-null is null”). Schema efectivă o calculează
 * useColorScheme din preferință + tema dispozitivului.
 */
export function applyThemePreference(pref: ThemePreference): void {
  memory = pref;
  for (const l of listeners) {
    try {
      l(pref);
    } catch {
      // ignore listener errors
    }
  }
}

export function getThemePreferenceSync(): ThemePreference {
  return memory;
}

export async function getThemePreference(): Promise<ThemePreference> {
  if (hydrated) return memory;
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = webStore()?.getItem(KEY) ?? null;
    } else {
      raw = await AsyncStorage.getItem(KEY);
    }
    memory = parsePref(raw);
  } catch {
    memory = 'system';
  }
  hydrated = true;
  applyThemePreference(memory);
  return memory;
}

export async function setThemePreference(pref: ThemePreference): Promise<void> {
  memory = pref;
  hydrated = true;
  try {
    if (Platform.OS === 'web') {
      webStore()?.setItem(KEY, pref);
    } else {
      await AsyncStorage.setItem(KEY, pref);
    }
  } catch {
    // best-effort
  }
  applyThemePreference(pref);
}

export function subscribeThemePreference(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
