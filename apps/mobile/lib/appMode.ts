import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type AppMode = 'client' | 'business';

const KEY = 'programari.appMode';

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseMode(value: string | null | undefined): AppMode | null {
  return value === 'client' || value === 'business' ? value : null;
}

export async function getAppMode(): Promise<AppMode | null> {
  try {
    if (Platform.OS === 'web') {
      return parseMode(webStore()?.getItem(KEY));
    }
    return parseMode(await AsyncStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export async function setAppMode(mode: AppMode): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      webStore()?.setItem(KEY, mode);
      return;
    }
    await AsyncStorage.setItem(KEY, mode);
  } catch {
    // persistence is best-effort
  }
}

/** account_kind din profil are prioritate; altfel cine deține un business e „business”. */
export function appModeFrom(accountKind: string | null | undefined, ownsBusiness: boolean): AppMode {
  return parseMode(accountKind) ?? (ownsBusiness ? 'business' : 'client');
}

/** Stored choice, or the dedicated account_kind on the profile. */
export async function resolveAppMode(userId: string): Promise<AppMode> {
  // Ambele citiri depind doar de userId → pleacă odată (un singur drum, nu două).
  const [{ data }, { data: owned }] = await Promise.all([
    supabase.from('profiles').select('account_kind').eq('id', userId).maybeSingle(),
    supabase.from('business_profiles').select('id').eq('owner_user_id', userId).maybeSingle(),
  ]);
  const mode = appModeFrom(data?.account_kind, Boolean(owned));
  await setAppMode(mode);
  return mode;
}
