/** Candidat client existent pentru completarea automată la walk-in (programare telefonică). */
export type WalkinClientCandidate = {
  clientUserId: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  visitCount: number;
};

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

/** Formă comparabilă a telefonului: fără prefix de țară și fără 0 inițial (0722... = +40722...). */
function phoneKey(value: string | null): string {
  let d = digits(value ?? '');
  if (d.startsWith('40')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  return d;
}

/**
 * Căutare instant în clienții existenți ai salonului (nume, telefon, email).
 * Sub 3 caractere nu sugerează nimic, ca să nu expună lista întreagă la fiecare tastare.
 */
export function searchWalkinClients(
  rows: WalkinClientCandidate[],
  rawQuery: string,
  limit = 6,
): WalkinClientCandidate[] {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < 3) return [];
  const qPhone = phoneKey(q);
  const out: WalkinClientCandidate[] = [];
  for (const row of rows) {
    const byName = (row.displayName ?? '').toLowerCase().includes(q);
    const byEmail = (row.email ?? '').toLowerCase().includes(q);
    const byPhone = qPhone.length >= 3 && phoneKey(row.phone).includes(qPhone);
    if (byName || byEmail || byPhone) out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}
