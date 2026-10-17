import { formatInTimeZone } from './timezone';

/** Ora locală (0-23) a firmei la momentul dat; null dacă data e invalidă. */
function localHour(startIso: string, timezone: string): number | null {
  const time = new Date(startIso).getTime();
  if (!Number.isFinite(time)) return null;
  const hour = Number(formatInTimeZone(new Date(time), timezone, 'H'));
  return Number.isFinite(hour) ? hour : null;
}

/** Slotul începe în fereastra orelor liniștite (suportă trecerea peste miezul nopții). */
export function isOffpeakStart(
  startIso: string,
  timezone: string,
  startHour: number | null | undefined,
  endHour: number | null | undefined,
  percent?: number | null
): boolean {
  if (startHour == null || endHour == null) return false;
  if (percent != null && (!Number.isFinite(percent) || percent <= 0)) return false;
  const hour = localHour(startIso, timezone);
  if (hour === null) return false;
  if (startHour <= endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

/** Preț cu reducere, rotunjit la 2 zecimale; reducerea e plafonată la 90%. */
export function discountedPrice(price: number, percent: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(percent) || percent <= 0) return price;
  const capped = Math.min(percent, 90);
  return Math.round(price * ((100 - capped) / 100) * 100) / 100;
}
