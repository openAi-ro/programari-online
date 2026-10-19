/**
 * Locale key for the word after the visit count.
 * RO: 1 vizită · 0 and 2–19 vizite · 20+ "de vizite" (101–119 → vizite again). EN: visit / visits.
 */
export function visitCountKey(n: number): 'cli.visitOne' | 'cli.visits' | 'cli.visitsMany' {
  const v = Math.abs(Math.trunc(Number(n) || 0));
  if (v === 1) return 'cli.visitOne';
  if (v === 0) return 'cli.visits';
  const rest = v % 100;
  return rest >= 1 && rest <= 19 ? 'cli.visits' : 'cli.visitsMany';
}
