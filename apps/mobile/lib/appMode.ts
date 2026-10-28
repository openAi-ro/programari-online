import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { fetchMemberBusinessIds } from './businessMembers';
import { supabase } from './supabase';
import { appModeFrom, canSwitchAppMode, type AppMode } from './teamAccess';

export type { AppMode } from './teamAccess';

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

export type ModeState = { mode: AppMode; canSwitch: boolean };

/** Zona curentă din profil + business-urile proprii sau din echipă + alegerea memorată. */
export async function resolveAppMode(userId: string): Promise<ModeState> {
  const [{ data }, { data: owned }, memberIds, stored] = await Promise.all([
    supabase.from('profiles').select('account_kind').eq('id', userId).maybeSingle(),
    supabase.from('business_profiles').select('id').eq('owner_user_id', userId).limit(1),
    fetchMemberBusinessIds(userId),
    getAppMode(),
  ]);
  const hasBusiness = (owned ?? []).length > 0 || memberIds.length > 0;
  const mode = appModeFrom(data?.account_kind, hasBusiness, stored);
  await setAppMode(mode);
  return { mode, canSwitch: canSwitchAppMode(data?.account_kind, hasBusiness) };
}
