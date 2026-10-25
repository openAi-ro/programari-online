/**
 * Serviciile oferite de fiecare specialist (tabela staff_services, v67).
 * Un specialist fără niciun rând face toate serviciile.
 */
export type StaffServiceRow = { staff_id: string; service_id: string };

/** staff_id -> serviciile bifate (doar specialiștii care au rânduri). */
export function staffServicesMap(rows: readonly StaffServiceRow[] | null | undefined): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const r of rows ?? []) {
    if (!r?.staff_id || !r.service_id) continue;
    (map[r.staff_id] ??= []).push(r.service_id);
  }
  return map;
}

/** Face specialistul serviciul? Fără rânduri = da; fără serviciu ales = da. */
export function staffOffersService(
  map: Record<string, string[]>,
  staffId: string,
  serviceId: string | null | undefined
): boolean {
  if (!serviceId) return true;
  const list = map[staffId];
  return !list || list.length === 0 || list.includes(serviceId);
}

/** Face specialistul TOATE serviciile alese? Fără servicii alese = da (ca pe server, v71). */
export function staffOffersServices(
  map: Record<string, string[]>,
  staffId: string,
  serviceIds: readonly string[]
): boolean {
  return serviceIds.every((id) => staffOffersService(map, staffId, id));
}

/** Specialiștii (în ordinea echipei) care fac serviciul ales. */
export function staffForService<T extends { id: string }>(
  team: readonly T[],
  map: Record<string, string[]>,
  serviceId: string | null | undefined
): T[] {
  return team.filter((m) => staffOffersService(map, m.id, serviceId));
}

/** Specialistul pentru serviciu: cel preferat dacă îl face, altfel primul care îl face; null dacă nimeni. */
export function pickStaffForService<T extends { id: string }>(
  team: readonly T[],
  map: Record<string, string[]>,
  serviceId: string | null | undefined,
  preferredId: string | null | undefined
): T | null {
  const eligible = staffForService(team, map, serviceId);
  return eligible.find((m) => m.id === preferredId) ?? eligible[0] ?? null;
}

/** Specialiștii (în ordinea echipei) care fac toate serviciile alese (rezervare combinată). */
export function staffForServices<T extends { id: string }>(
  team: readonly T[],
  map: Record<string, string[]>,
  serviceIds: readonly string[]
): T[] {
  return team.filter((m) => staffOffersServices(map, m.id, serviceIds));
}

/** Bifele de pornire în editor: fără rânduri = toate serviciile bifate. */
export function initialServiceSelection(
  existing: readonly string[],
  allServiceIds: readonly string[]
): string[] {
  const valid = existing.filter((id) => allServiceIds.includes(id));
  return valid.length > 0 ? valid : [...allServiceIds];
}

/**
 * Ce scriem la salvare. Toate bifate = niciun rând (face tot, inclusiv servicii noi).
 * Nimic bifat = eroare (specialistul n-ar mai putea fi programat).
 */
export function staffServicesPlan(
  selected: readonly string[],
  allServiceIds: readonly string[],
  existing: readonly string[]
): { error: 'none_selected' | null; insertIds: string[]; deleteIds: string[] } {
  const chosen = [...new Set(selected.filter((id) => allServiceIds.includes(id)))];
  if (allServiceIds.length > 0 && chosen.length === 0) {
    return { error: 'none_selected', insertIds: [], deleteIds: [] };
  }
  const all = chosen.length === allServiceIds.length;
  const target = all ? [] : chosen;
  return {
    error: null,
    insertIds: target.filter((id) => !existing.includes(id)),
    deleteIds: existing.filter((id) => !target.includes(id)),
  };
}
