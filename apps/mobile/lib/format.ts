import { localeTag, trKey } from './i18n';

/** Preț în lei (RON). 0 = preț la fața locului. */
export function formatRon(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (!Number.isFinite(n) || n <= 0) return trKey('price.onSite');
  const formatted = n.toLocaleString(localeTag(), {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} lei`;
}

/** Sumă în lei, inclusiv 0. */
export function formatLei(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  if (!Number.isFinite(n)) return '0 lei';
  const formatted = n.toLocaleString(localeTag(), {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${formatted} lei`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return h === 1 ? trKey('duration.hourOne') : trKey('duration.hours', { h });
  return `${h} h ${m} min`;
}
