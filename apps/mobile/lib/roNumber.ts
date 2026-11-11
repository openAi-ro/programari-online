/**
 * Româna cere „de” între număr și substantiv de la 20 în sus („30 de zile”, „25 de confirmate”),
 * dar nu pentru 0–19 sau când ultimele două cifre sunt 01–19 („105 zile”).
 */
export function roDe(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  return abs >= 20 && (lastTwo === 0 || lastTwo >= 20) ? 'de ' : '';
}

/** „Mai lipsește: X.” pentru un singur element, „Mai lipsesc: X, Y.” pentru mai multe. */
export function missingListKey(count: number): 'set.missingList' | 'set.missingListOne' {
  return count > 1 ? 'set.missingList' : 'set.missingListOne';
}

/**
 * Cheia și parametrii pentru „1 afacere” / „5 afaceri” / „20 de afaceri”.
 * `one` se folosește doar pentru exact 1; „de” doar în română.
 */
export function countArgs<K extends string>(
  n: number,
  one: K,
  many: K,
  lang: string,
  extra: Record<string, string | number> = {},
): [K, Record<string, string | number>] {
  return [n === 1 ? one : many, { ...extra, n, count: n, de: lang === 'ro' ? roDe(n) : '' }];
}
