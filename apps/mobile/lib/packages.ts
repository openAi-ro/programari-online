/** Ședințe rămase dintr-un pachet (niciodată negativ). */
export function sessionsLeft(total: number, used: number): number {
  return Math.max(0, (total || 0) - (used || 0));
}

export function isPackageExhausted(total: number, used: number): boolean {
  return sessionsLeft(total, used) <= 0;
}

/**
 * Aplică o folosire (+1) sau o restituire (-1) de ședință.
 * Întoarce noul număr de ședințe folosite sau null dacă mișcarea e invalidă.
 */
export function applySessionUse(total: number, used: number, delta: number): number | null {
  if (delta !== 1 && delta !== -1) return null;
  const next = (used || 0) + delta;
  if (next < 0 || next > (total || 0)) return null;
  return next;
}
