import { useEffect, useState } from 'react';

/**
 * How many px of the layout viewport are covered at the bottom (mobile web keyboard).
 * On Android Chrome the keyboard shrinks only the *visual* viewport, so fixed/bottom
 * sheets stay under it unless we lift them by this amount.
 */
export function keyboardOverlap(layoutHeight: number, visualHeight: number, visualOffsetTop: number): number {
  if (!(layoutHeight > 0) || !(visualHeight > 0)) return 0;
  return Math.max(0, Math.round(layoutHeight - visualHeight - Math.max(0, visualOffsetTop)));
}

/** Web only: bottom inset to keep a bottom sheet above the on-screen keyboard (0 elsewhere). */
export function useWebKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    // Doar web are visualViewport (nativ: undefined → 0).
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!active || !vv) return;
    const update = () => setInset(keyboardOverlap(window.innerHeight, vv.height, vv.offsetTop));
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      setInset(0);
    };
  }, [active]);
  return inset;
}
