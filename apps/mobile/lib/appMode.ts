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

/** Stored choice, or the dedicated account_kind on the profile. */
export async function resolveAppMode(userId: string): Promise<AppMode> {
  const { data } = await supabase
    .from('profiles')
    .select('account_kind')
    .eq('id', userId)
    .maybeSingle();

  const fromProfile = parseMode(data?.account_kind);
  if (fromProfile) {
    await setAppMode(fromProfile);
    return fromProfile;
  }

  const { data: owned } = await supabase
    .from('business_profiles')
    .select('id')
    .eq('owner_user_id', userId)
    .maybeSingle();

  const mode: AppMode = owned ? 'business' : 'client';
  await setAppMode(mode);
  return mode;
}
