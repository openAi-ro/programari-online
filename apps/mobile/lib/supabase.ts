import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!url || !anon) {
  console.warn(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.'
  );
}

/** Memory storage for SSR / Node (no window). Avoids "window is not defined". */
const memoryStorage: SupportedStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => {},
  removeItem: async (_key: string) => {},
};

function createAuthStorage(): SupportedStorage {
  // Expo web SSR runs this module in Node — AsyncStorage touches `window`.
  if (typeof window === 'undefined') {
    return memoryStorage;
  }
  return AsyncStorage;
}

const isBrowser = typeof window !== 'undefined';

export const supabase = createClient(url, anon, {
  auth: {
    storage: createAuthStorage(),
    autoRefreshToken: isBrowser,
    persistSession: isBrowser,
    detectSessionInUrl: false,
  },
});
