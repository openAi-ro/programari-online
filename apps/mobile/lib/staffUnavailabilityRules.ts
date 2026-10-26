/** Reguli pure pentru indisponibilitatea specialiștilor (v90), fără acces la date. */
export type StaffUnavailabilityRange = {
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD, inclusiv
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function validateUnavailabilityRange(startDate: string, endDate: string): string | null {
  if (!YMD.test(startDate) || !YMD.test(endDate)) return 'unavailability_range_invalid';
  if (endDate < startDate) return 'unavailability_range_invalid';
  return null;
}

/** Datele sunt YYYY-MM-DD, deci comparația lexicografică este și cronologică. */
export function unavailabilityCoversDate(row: StaffUnavailabilityRange, ymd: string): boolean {
  return row.start_date <= ymd && ymd <= row.end_date;
}

export function unavailabilityOverlapsRange(
  row: StaffUnavailabilityRange,
  fromYmd: string,
  toYmd: string,
): boolean {
  return row.start_date <= toYmd && fromYmd <= row.end_date;
}
