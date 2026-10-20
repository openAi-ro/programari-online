import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Rulează `callback` la `intervalMs` doar cât aplicația e în prim-plan.
 * În fundal intervalul se oprește; la revenire rulează o dată și repornește.
 */
export function useForegroundInterval(callback: () => void, intervalMs: number, enabled = true): void {
  const cb = useRef(callback);
  cb.current = callback;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => cb.current(), intervalMs);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        cb.current();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [intervalMs, enabled]);
}
