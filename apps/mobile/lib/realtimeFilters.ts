/**
 * Filtru Realtime (postgres_changes) pe business_id: serverul trimite doar rândurile
 * salonului/saloanelor proprii, nu toate programările pe care RLS le-ar permite.
 * Notă: evenimentele DELETE nu pot fi filtrate de Realtime; ecranele au sondaj de rezervă.
 */
export function businessIdFilter(ids: readonly string[]): string | null {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (clean.length === 0) return null;
  if (clean.length === 1) return `business_id=eq.${clean[0]}`;
  return `business_id=in.(${clean.join(',')})`;
}