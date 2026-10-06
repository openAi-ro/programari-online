import { useEffect, useState } from 'react';
import { useColorScheme as useColorSchemeCore } from 'react-native';

import {
  getThemePreference,
  getThemePreferenceSync,
  subscribeThemePreference,
  type ThemePreference,
} from '@/lib/themePreference';

/**
 * Scheme efectiv pentru UI: preferința din Setări, sau tema dispozitivului
 * când e „system”.
 */
export function useColorScheme(): 'light' | 'dark' {
  const system = useColorSchemeCore();
  const [pref, setPref] = useState<ThemePreference>(() => getThemePreferenceSync());

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

  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'unspecified' || system == null ? 'light' : system;
}
