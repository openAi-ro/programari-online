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

/** `?lang=ro|en` în adresă (web, ex. iframe pe site-ul firmei): are prioritate doar la încărcarea asta, nu se salvează. */
function urlLanguage(): AppLanguage | null {
  try {
    const v = new URLSearchParams(window.location.search).get('lang');
    return v === 'ro' || v === 'en' ? v : null;
  } catch {
    return null;
  }
}

/** Ce face aplicația cu limba la autentificare (test încrucișat P6). */
export type LanguageSync =
  | { kind: 'apply'; lang: AppLanguage } // limba aleasă explicit în Setări, pe alt dispozitiv
  | { kind: 'push'; lang: AppLanguage } // profilul n-are alegere: emailurile urmează limba afișată
  | null;

/**
 * Alegerea explicită din Setări (`language_set_at`) câștigă pe orice dispozitiv. Fără ea,
 * valoarea 'ro' din profil e doar implicită, deci profilul preia limba afișată. `?lang=` din
 * adresă (iframe) nu schimbă nimic.
 */
export function languageSyncAction(
  profile: { language?: string | null; language_set_at?: string | null } | null | undefined,
  current: AppLanguage,
  urlOverride: boolean
): LanguageSync {
  if (urlOverride || !profile) return null;
  if (profile.language_set_at) {
    if (profile.language !== 'ro' && profile.language !== 'en') return null;
    return profile.language === current ? null : { kind: 'apply', lang: profile.language };
  }
  return profile.language === current ? null : { kind: 'push', lang: current };
}

/** true când adresa web are `?lang=ro|en` (ex. iframe pe site-ul firmei). */
export function hasUrlLanguage(): boolean {
  return isWeb() && urlLanguage() != null;
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
      raw = urlLanguage() ?? webStore()?.getItem(KEY) ?? null;
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
