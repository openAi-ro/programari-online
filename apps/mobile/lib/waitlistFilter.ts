type DatedRow = { desired_date: string };

/** Zilele distincte din lista de așteptare, sortate crescător. */
export function waitlistDates<T extends DatedRow>(rows: readonly T[]): string[] {
  return [...new Set(rows.map((r) => r.desired_date))].sort();
}

/** Rândurile pentru ziua aleasă; `null` înseamnă toate zilele. */
export function filterWaitlistByDate<T extends DatedRow>(
  rows: readonly T[],
  date: string | null,
): T[] {
  if (!date) return [...rows];
  return rows.filter((r) => r.desired_date === date);
}
