import { useCallback, useEffect, useRef, useState } from 'react';

/** Cât stă pe ecran un mesaj de rezultat (succes / eroare a unei acțiuni) înainte să dispară singur. */
export const TRANSIENT_MESSAGE_MS = 30_000;

/**
 * `sticky`: mesajul descrie o stare care persistă (ex. ecranul nu s-a putut încărca),
 * nu rezultatul unei acțiuni — rămâne până la următorul mesaj sau până e închis cu ×.
 */
export type ShowMessage = (message: string | null, opts?: { sticky?: boolean }) => void;

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Ceasul unui singur mesaj: fiecare mesaj nou repornește cele 30 s; `cancel` la demontare. */
export function createTransientClock(onExpire: () => void, ms = TRANSIENT_MESSAGE_MS, timers = defaultTimers) {
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  return {
    arm(sticky = false) {
      cancel();
      if (sticky) return;
      handle = timers.set(() => {
        handle = null;
        onExpire();
      }, ms);
    },
    cancel,
  };
}

/** Ca `useState<string | null>`, dar mesajul dispare singur după 30 s (dacă nu e `sticky`). */
export function useTransientMessage(): [string | null, ShowMessage] {
  const [message, setMessage] = useState<string | null>(null);
  const clock = useRef<ReturnType<typeof createTransientClock> | null>(null);
  if (!clock.current) clock.current = createTransientClock(() => setMessage(null));
  useEffect(() => () => clock.current?.cancel(), []);
  const show = useCallback<ShowMessage>((next, opts) => {
    setMessage(next);
    if (next) clock.current!.arm(opts?.sticky);
    else clock.current!.cancel();
  }, []);
  return [message, show];
}
