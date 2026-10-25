/**
 * Dictare în chat (web): Web Speech API din browser (Chrome/Edge/Safari).
 * Pe aplicația nativă nu există încă modul de recunoaștere vocală în build,
 * așa că butonul de microfon nu apare acolo (vezi useDictation).
 */

/** Textul din câmp după dictare: ce era scris + ce s-a dictat, cu un spațiu între ele. */
export function joinDictation(base: string, spoken: string): string {
  const said = spoken.replace(/\s+/g, ' ').trim();
  if (!said) return base;
  const head = base.replace(/\s+$/, '');
  return head ? `${head} ${said}` : said;
}

/** Mesajul afișat pentru o eroare a recunoașterii vocale (null = nimic de arătat). */
export function dictationErrorKind(code: string | undefined): 'denied' | 'failed' | null {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'denied';
  if (code === 'aborted' || code === 'no-speech') return null;
  return 'failed';
}
