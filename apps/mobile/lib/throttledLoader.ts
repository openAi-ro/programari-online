/**
 * Încărcare partajată cu prag minim între cereri: toți cei care cer valoarea
 * în fereastra `minIntervalMs` primesc ultimul rezultat (sau cererea în curs),
 * în loc să plece câte o cerere nouă la fiecare ecran / tab.
 */
export type ThrottledLoader<T> = {
  /** `force` ignoră pragul (ex. după un eveniment realtime). */
  get(force?: boolean): Promise<T>;
  /** Uită valoarea: următorul `get` merge la server (ex. după „citit” sau logout). */
  reset(): void;
};

export function createThrottledLoader<T>(
  load: () => Promise<T>,
  minIntervalMs: number,
  now: () => number = Date.now
): ThrottledLoader<T> {
  let hasValue = false;
  let value: T;
  let loadedAt = 0;
  let inflight: Promise<T> | null = null;
  let generation = 0;

  return {
    get(force = false) {
      if (inflight) return inflight;
      if (!force && hasValue && now() - loadedAt < minIntervalMs) {
        return Promise.resolve(value);
      }
      const gen = generation;
      const p = load()
        .then((v) => {
          if (gen === generation) {
            value = v;
            hasValue = true;
            loadedAt = now();
          }
          return v;
        })
        .finally(() => {
          if (inflight === p) inflight = null;
        });
      inflight = p;
      return p;
    },
    reset() {
      generation += 1;
      hasValue = false;
      loadedAt = 0;
      inflight = null;
    },
  };
}
