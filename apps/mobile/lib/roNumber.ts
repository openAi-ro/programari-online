/**
 * Româna cere „de” între număr și substantiv de la 20 în sus („30 de zile”, „25 de confirmate”),
 * dar nu pentru 0–19 sau când ultimele două cifre sunt 01–19 („105 zile”).
 */
export function roDe(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  return abs >= 20 && (lastTwo === 0 || lastTwo >= 20) ? 'de ' : '';
}
