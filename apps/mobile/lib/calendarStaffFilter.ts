/**
 * Filtrul calendarului business pe un specialist. O programare fara specialist (staff_id null)
 * blocheaza intervalul pentru toti specialistii (v85), deci apare in filtrul fiecaruia.
 * Intoarce expresia PostgREST pentru `.or(...)`, sau null daca id-ul nu e un uuid.
 */
export function staffOrUnassignedFilter(staffId: string): string | null {
  if (!/^[0-9a-f-]{36}$/i.test(staffId)) return null;
  return `staff_id.eq.${staffId},staff_id.is.null`;
}
