export type ServiceChecklistState =
  | { kind: 'ok' }
  | { kind: 'none' }
  | { kind: 'inactive'; names: string[] };

/**
 * Starea serviciilor pentru checklist-ul cărții de vizită.
 * `inactive` păstrează numele, ca mesajul să spună ce serviciu trebuie activat.
 */
export function serviceChecklistState(
  services: readonly { name: string; active: boolean }[],
): ServiceChecklistState {
  if (services.some((s) => s.active)) return { kind: 'ok' };
  const names = services
    .map((s) => s.name.trim())
    .filter((n) => n.length > 0);
  if (names.length === 0) return { kind: 'none' };
  return { kind: 'inactive', names };
}
