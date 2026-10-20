import { createContext, createElement, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getLanguage,
  getLanguageSync,
  subscribeLanguage,
  type AppLanguage,
} from './language';
import { ro } from './locales/ro';
import { en } from './locales/en';

/** Cheie de traducere = cheie din dicționarul român (sursa de adevăr). */
export type TrKey = keyof typeof ro;
export type TrVars = Record<string, string | number>;
export type { AppLanguage };

const DICTS: Record<AppLanguage, typeof ro> = { ro, en };

function fill(template: string, vars?: TrVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    vars[name] === undefined ? m : String(vars[name])
  );
}

function translate(lang: AppLanguage, key: TrKey, vars?: TrVars): string {
  const hit = DICTS[lang][key] ?? ro[key] ?? key;
  return fill(hit, vars);
}

/** Traduce o cheie într-o limbă specificată, indiferent de limba curentă. */
export function translateTo(lang: AppLanguage, key: TrKey, vars?: TrVars): string {
  return translate(lang, key, vars);
}

/**
 * Traducere pentru cod non-React (lib/*): citește limba curentă din memorie.
 * Componentele primesc re-render prin provider; aici limba e cea setată
 * la ultimul render/hidratare.
 */
export function trKey(key: TrKey, vars?: TrVars): string {
  return translate(getLanguageSync(), key, vars);
}

type LanguageContextValue = {
  lang: AppLanguage;
  t: (key: TrKey, vars?: TrVars) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'ro',
  t: (key, vars) => translate('ro', key, vars),
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<AppLanguage>(() => getLanguageSync());

  useEffect(() => {
    void getLanguage().then(setLang);
    return subscribeLanguage(setLang);
  }, []);

  const t = (key: TrKey, vars?: TrVars) => translate(lang, key, vars);
  // .ts file (no JSX): same as <LanguageContext.Provider value={{ lang, t }}>{children}</...>
  return createElement(LanguageContext.Provider, { value: { lang, t } }, children);
}

/** În componente: `const tr = useT();` apoi `tr('settings.title')`. */
/** Etichetă de locală (ex. ro-RO / en-IE) după limba curentă. */
export function localeTag(): string {
  return getLanguageSync() === 'en' ? 'en-IE' : 'ro-RO';
}

export function useT(): (key: TrKey, vars?: TrVars) => string {
  return useContext(LanguageContext).t;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
