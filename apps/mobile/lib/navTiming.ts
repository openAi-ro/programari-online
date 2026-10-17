/**
 * DEV-only nav switch timing (business tab bar).
 * Metro console: look for [NAV] lines.
 * Toggle BEFORE mode: globalThis.__MEASURE_BEFORE = true
 */
declare global {
  // eslint-disable-next-line no-var
  var __NAV_T0: number | undefined;
  // eslint-disable-next-line no-var
  var __NAV_TARGET: string | undefined;
  // eslint-disable-next-line no-var
  var __MEASURE_BEFORE: boolean | undefined;
}

export function measureBeforeEnabled(): boolean {
  return typeof globalThis !== 'undefined' && globalThis.__MEASURE_BEFORE === true;
}

export function markNavStart(target: string): void {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  globalThis.__NAV_T0 = now;
  globalThis.__NAV_TARGET = target;
  // eslint-disable-next-line no-console
  console.log(`[NAV] START → ${target} t0=${now.toFixed(1)}`);
}

export function markNavReady(
  screen: string,
  opts?: { hasExistingData?: boolean; softRefresh?: boolean }
): void {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return;
  const t0 = globalThis.__NAV_T0;
  if (t0 == null) return;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const ms = now - t0;
  const soft = opts?.softRefresh === true;
  const has = opts?.hasExistingData === true;
  // eslint-disable-next-line no-console
  console.log(
    `[NAV] READY ${screen} ms=${ms.toFixed(0)} soft=${soft} hasExistingData=${has} target=${globalThis.__NAV_TARGET ?? '?'}`
  );
  // clear so late loads don't double-report against stale t0
  globalThis.__NAV_T0 = undefined;
}
