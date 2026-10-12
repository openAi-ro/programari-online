// NOTE: no static react-native / AsyncStorage imports here on purpose -
// plain-node test runners (tsx) import this module via lib/i18n and must not
// pull native code at load time. Native pieces load lazily below.

/** Limbi suportate de aplicație. Româna rămâne implicită. */
export type AppLanguage = 'ro' | 'en';

const KEY = 'programari.language';

type Listener = (lang: AppLanguage) => void;
const listeners = new Set<Listener>();
let memory: AppLanguage = 'ro';
let hydrated = false;

function isWeb(): boolean {
  try {
    if (
      typeof navigator !== 'undefined' &&
      (navigator as { product?: string }).product === 'ReactNative'
    ) {
      return false;
    }
    return typeof window !== 'undefined' && typeof window.document !== 'undefined';
  } catch {
    return false;
  }
}

type NativeStore = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
};

async function nativeStore(): Promise<NativeStore | null> {
  try {
    const mod = await import('@react-native-async-storage/async-storage');
    return ((mod as { default?: NativeStore }).default ?? mod) as NativeStore;
  } catch {
    return null;
  }
}

function webStore(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function parseLanguage(value: string | null | undefined): AppLanguage {
  return value === 'en' || value === 'ro' ? value : 'ro';
}

/** Limba dispozitivului: engleză doar dacă începe cu "en", altfel română. */
export function deviceLanguage(): AppLanguage {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    return tag.toLowerCase().startsWith('en') ? 'en' : 'ro';
  } catch {
    return 'ro';
  }
}

export function applyLanguage(lang: AppLanguage): void {
  memory = lang;
  for (const l of listeners) {
    try {
      l(lang);
    } catch {
      // ignore listener errors
    }
  }
}

export function getLanguageSync(): AppLanguage {
  return memory;
}

export async function getLanguage(): Promise<AppLanguage> {
  if (hydrated) return memory;
  try {
    let raw: string | null = null;
    if (isWeb()) {
      raw = webStore()?.getItem(KEY) ?? null;
    } else {
      try {
        const store = await nativeStore();
        raw = (await store?.getItem(KEY)) ?? null;
      } catch {
        raw = null;
      }
    }
    memory = raw == null ? deviceLanguage() : parseLanguage(raw);
  } catch {
    memory = 'ro';
  }
  hydrated = true;
  applyLanguage(memory);
  return memory;
}

export async function setLanguage(lang: AppLanguage): Promise<void> {
  memory = lang;
  hydrated = true;
  try {
    if (isWeb()) {
      webStore()?.setItem(KEY, lang);
    } else {
      try {
        const store = await nativeStore();
        await store?.setItem(KEY, lang);
      } catch {
        // best-effort
      }
    }
  } catch {
    // best-effort
  }
  applyLanguage(lang);
}

export function subscribeLanguage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
