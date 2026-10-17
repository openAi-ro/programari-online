type ComboService = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
};

/** Bifează/debifează un serviciu în selecția combinată. */
export function toggleServiceId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** Serviciile alese, în ordinea bifării; id-urile necunoscute sunt ignorate. */
export function selectedServices<T extends ComboService>(
  services: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const out: T[] = [];
  for (const id of ids) {
    const svc = byId.get(id);
    if (svc && !out.includes(svc)) out.push(svc);
  }
  return out;
}

export type ComboTotals = {
  count: number;
  durationMinutes: number;
  price: number;
  name: string;
};

/** Totaluri pentru blocul combinat: duratele și prețurile se adună. */
export function comboTotals(
  services: readonly ComboService[],
  ids: readonly string[],
): ComboTotals {
  const picked = selectedServices(services, ids);
  return {
    count: picked.length,
    durationMinutes: picked.reduce((sum, s) => sum + (s.duration_minutes || 0), 0),
    price: picked.reduce((sum, s) => sum + (Number(s.price) || 0), 0),
    name: picked.map((s) => s.name).join(' + '),
  };
}
