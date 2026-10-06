import { useEffect, useState } from 'react';

import {
  getThemePreference,
  getThemePreferenceSync,
  subscribeThemePreference,
  type ThemePreference,
} from '@/lib/themePreference';

type Scheme = 'light' | 'dark';

function systemScheme(): Scheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Pe web: preferința din Setări, altfel prefers-color-scheme.
 */
export function useColorScheme(): Scheme {
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreferenceSync());
  const [system, setSystem] = useState<Scheme>('light');

  useEffect(() => {
    let cancelled = false;
    void getThemePreference().then((p) => {
      if (!cancelled) setPref(p);
    });
    const unsub = subscribeThemePreference((p) => setPref(p));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystem(query.matches ? 'dark' : 'light');
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  if (pref === 'light' || pref === 'dark') return pref;
  return system;
}
