import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const FLAG_KEY = 'programari.rememberPassword.enabled';
const EMAIL_KEY = 'programari.rememberPassword.email';
const PASSWORD_KEY = 'programari.rememberPassword.password';

export type RememberedCredentials = {
  email: string;
  password: string;
};

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

async function secureAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const SecureStore = await import('expo-secure-store');
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

async function setItem(key: string, value: string, secure: boolean): Promise<void> {
  if (secure) {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
    return;
  }
  if (Platform.OS === 'web') {
    webStore()?.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function getItem(key: string, secure: boolean): Promise<string | null> {
  if (secure) {
    const SecureStore = await import('expo-secure-store');
    return SecureStore.getItemAsync(key);
  }
  if (Platform.OS === 'web') {
    return webStore()?.getItem(key) ?? null;
  }
  return AsyncStorage.getItem(key);
}

async function deleteItem(key: string, secure: boolean): Promise<void> {
  if (secure) {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.deleteItemAsync(key);
    return;
  }
  if (Platform.OS === 'web') {
    webStore()?.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

/** Flag „Reține parola” — AsyncStorage / localStorage (nu e secret). */
export async function getRememberPasswordEnabled(): Promise<boolean> {
  try {
    const raw =
      Platform.OS === 'web'
        ? webStore()?.getItem(FLAG_KEY) ?? null
        : await AsyncStorage.getItem(FLAG_KEY);
    return raw === '1';
  } catch {
    return false;
  }
}

export async function setRememberPasswordEnabled(enabled: boolean): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (enabled) webStore()?.setItem(FLAG_KEY, '1');
      else webStore()?.removeItem(FLAG_KEY);
    } else if (enabled) {
      await AsyncStorage.setItem(FLAG_KEY, '1');
    } else {
      await AsyncStorage.removeItem(FLAG_KEY);
    }
  } catch {
    // best-effort
  }
}

/**
 * Salvează email + parolă când „Reține parola” e bifat.
 * Parola: expo-secure-store pe native; pe web — localStorage (fallback documentat).
 */
export async function saveRememberedCredentials(
  email: string,
  password: string,
): Promise<void> {
  const e = email.trim();
  if (!e || !password) return;
  const secure = await secureAvailable();
  await setRememberPasswordEnabled(true);
  await setItem(EMAIL_KEY, e, false);
  await setItem(PASSWORD_KEY, password, secure);
}

/** Șterge credențialele salvate (când debifezi sau la logout opțional). */
export async function clearRememberedCredentials(): Promise<void> {
  const secure = await secureAvailable();
  await setRememberPasswordEnabled(false);
  await deleteItem(EMAIL_KEY, false);
  await deleteItem(PASSWORD_KEY, secure);
  // curăță și cealaltă stocare, în caz că s-a schimbat platforma
  try {
    await deleteItem(PASSWORD_KEY, !secure);
  } catch {
    /* ignore */
  }
}

export async function loadRememberedCredentials(): Promise<RememberedCredentials | null> {
  try {
    const enabled = await getRememberPasswordEnabled();
    if (!enabled) return null;
    const email = (await getItem(EMAIL_KEY, false))?.trim() || '';
    if (!email) return null;
    const secure = await secureAvailable();
    let password = (await getItem(PASSWORD_KEY, secure)) ?? '';
    if (!password && secure) {
      // migrație / web→native: încearcă și AsyncStorage
      password = (await getItem(PASSWORD_KEY, false)) ?? '';
    }
    if (!password) return { email, password: '' };
    return { email, password };
  } catch {
    return null;
  }
}
