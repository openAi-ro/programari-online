import { useEffect, useState } from 'react';

type Scheme = 'light' | 'dark';

function systemScheme(): Scheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Pe web pornim de la 'light' (aceasta e și culoarea randată în HTML de +html.tsx),
 * apoi urmărim `prefers-color-scheme` după montare, ca să nu existe mismatch la hidratare.
 */
export function useColorScheme(): Scheme {
  const [scheme, setScheme] = useState<Scheme>('light');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setScheme(query.matches ? 'dark' : 'light');
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return scheme;
}
