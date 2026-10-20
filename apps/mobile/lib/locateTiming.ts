/**
 * Locație fără timeout în timpul dialogului de permisiune.
 *
 * Chrome real pornește `options.timeout` din geolocation înainte ca utilizatorul să
 * răspundă la dialog (verificat: eroare TIMEOUT cu dialogul încă deschis), deci pe
 * web nu trimitem `timeout` cât timp permisiunea e „prompt”. Timer-ul nostru pornește
 * doar la o acordare OBSERVATĂ, iar o poziție care vine după eroare e acceptată.
 */

export type LocateTimingOptions<T> = {
  /** Cod de eroare la expirarea timer-ului de după acordare. */
  code?: string;
  /** Limită generoasă pentru dialogul lăsat deschis (fallback UI, fără spinner infinit). */
  promptMs?: number;
  promptCode?: string;
  /** Poziție sosită după ce am raportat deja expirarea: înlocuiește starea de eroare. */
  onLate?: (value: T) => void;
};

/**
 * Rezolvă cu poziția; timer-ul `ms` pornește doar când `granted` se rezolvă.
 * `granted` care nu se rezolvă = fără timer după acordare (rămâne doar `promptMs`).
 */
export function timeoutAfterGrant<T>(
  position: Promise<T>,
  granted: Promise<unknown>,
  ms: number,
  opts: LocateTimingOptions<T> = {}
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let grantedSeen = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let promptTimer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => {
      if (timer) clearTimeout(timer);
      if (promptTimer) clearTimeout(promptTimer);
      timer = null;
      promptTimer = null;
    };
    const expire = (code: string) => {
      if (settled) return;
      settled = true;
      clear();
      reject(new Error(code));
    };
    position.then(
      (v) => {
        if (settled) {
          opts.onLate?.(v);
          return;
        }
        settled = true;
        clear();
        resolve(v);
      },
      (e) => {
        if (settled) return;
        settled = true;
        clear();
        reject(e);
      }
    );
    if (opts.promptMs != null) {
      promptTimer = setTimeout(() => {
        if (!grantedSeen) expire(opts.promptCode ?? 'permission_timeout');
      }, opts.promptMs);
    }
    granted.then(
      () => {
        if (settled || grantedSeen) return;
        grantedSeen = true;
        if (promptTimer) clearTimeout(promptTimer);
        promptTimer = null;
        timer = setTimeout(() => expire(opts.code ?? 'location_timeout'), ms);
      },
      () => {}
    );
  });
}

type PermissionStatusLike = {
  state: string;
  addEventListener?: (type: 'change', cb: () => void) => void;
  removeEventListener?: (type: 'change', cb: () => void) => void;
};

/**
 * Semnal „permisiunea de locație a fost acordată” pe web (Permissions API).
 * Se rezolvă imediat dacă e deja acordată, altfel la evenimentul `change`
 * sau la verificarea periodică (`pollMs`, rezervă dacă evenimentul lipsește).
 * `initial` = starea găsită la început (pentru a decide dacă folosim timeout nativ).
 */
export function grantSignal(
  query: (() => Promise<PermissionStatusLike>) | null,
  pollMs = 1000
): { granted: Promise<void>; initial: Promise<string>; dispose: () => void } {
  let disposed = false;
  let cleanup = () => {};
  let resolveInitial: (s: string) => void = () => {};
  const initial = new Promise<string>((r) => (resolveInitial = r));
  const granted = new Promise<void>((resolve) => {
    if (!query) {
      resolveInitial('unsupported');
      return;
    }
    query().then(
      (st) => {
        resolveInitial(st.state);
        if (st.state === 'granted') return resolve();
        if (disposed) return;
        const check = () => {
          if (st.state !== 'granted') return;
          cleanup();
          resolve();
        };
        st.addEventListener?.('change', check);
        const poll = setInterval(() => {
          // Re-citim starea: unele browsere nu emit `change` pentru „Allow this time”.
          query().then((s2) => {
            if (s2.state === 'granted') {
              cleanup();
              resolve();
            }
          }, () => {});
        }, pollMs);
        cleanup = () => {
          st.removeEventListener?.('change', check);
          clearInterval(poll);
          cleanup = () => {};
        };
      },
      () => resolveInitial('unsupported')
    );
  });
  return {
    granted,
    initial,
    dispose: () => {
      disposed = true;
      cleanup();
    },
  };
}
