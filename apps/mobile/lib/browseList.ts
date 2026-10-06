import { formatInTimeZone } from 'date-fns-tz';

import type { DayKey, WorkingHours } from './types';

export type BusinessSortKey = 'name' | 'rating' | 'distance';

const ISO_DOW_TO_DAY: Record<string, DayKey> = {
  '1': 'mon',
  '2': 'tue',
  '3': 'wed',
  '4': 'thu',
  '5': 'fri',
  '6': 'sat',
  '7': 'sun',
};

/**
 * E deschis business-ul acum? Necesita program + timezone (dupa migrarea v33).
 * Intoarce null cand nu se poate stabili (lipsa date) — apelantul decide
 * afisarea (badge ascuns, rand pastrat la filtru).
 */
export function isOpenNow(
  workingHours: WorkingHours | null | undefined,
  timezone: string | null | undefined,
  now = new Date()
): boolean | null {
  if (!workingHours || !timezone) return null;
  let dayKey: DayKey;
  let hm: string;
  try {
    dayKey = ISO_DOW_TO_DAY[formatInTimeZone(now, timezone, 'i')] ?? 'mon';
    hm = formatInTimeZone(now, timezone, 'HH:mm');
  } catch {
    return null;
  }
  const day = workingHours[dayKey];
  if (!day || day.closed) return false;
  return day.start <= hm && hm < day.end;
}

export type SortableBusiness = {
  name: string;
  avg_rating: number | null;
  review_count: number;
};

/** Sorteaza randuri compacte: rating (doar cu recenzii, nulle la final), distanta, nume. */
export function sortBusinesses<T extends SortableBusiness>(
  rows: T[],
  sort: BusinessSortKey,
  distanceOf?: (row: T) => number | null
): T[] {
  const list = [...rows];
  switch (sort) {
    case 'rating':
      list.sort((a, b) => {
        const aRated = a.avg_rating != null && a.review_count > 0;
        const bRated = b.avg_rating != null && b.review_count > 0;
        if (aRated && bRated) {
          const d = (b.avg_rating as number) - (a.avg_rating as number);
          if (d !== 0) return d;
          const c = b.review_count - a.review_count;
          if (c !== 0) return c;
          return a.name.localeCompare(b.name, 'ro');
        }
        if (aRated) return -1;
        if (bRated) return 1;
        return a.name.localeCompare(b.name, 'ro');
      });
      return list;
    case 'distance': {
      const dist = distanceOf ?? (() => null);
      list.sort((a, b) => {
        const da = dist(a);
        const db = dist(b);
        if (da != null && db != null && da !== db) return da - db;
        if (da != null && db == null) return -1;
        if (da == null && db != null) return 1;
        return a.name.localeCompare(b.name, 'ro');
      });
      return list;
    }
    case 'name':
    default:
      list.sort((a, b) => a.name.localeCompare(b.name, 'ro'));
      return list;
  }
}
