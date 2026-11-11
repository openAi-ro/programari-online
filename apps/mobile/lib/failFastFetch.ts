/**
 * Retest 3.25 (Designer Android): postgrest-js reîncearcă singur fiecare citire de 3 ori
 * (1 s + 2 s + 4 s) și când rețeaua lipsește, iar Acasă face mai multe runde de citiri una după
 * alta, deci offline ecranul stătea 25–30 s pe „Se încarcă…”. Biblioteca sare peste reîncercări
 * doar pentru cererile anulate (code ABORT_ERR), așa că o cerere respinsă de rețea (fără internet,
 * DNS) e marcată la fel și eșuează imediat. Mesajul rămâne cel original („TypeError: Failed to
 * fetch”), deci `userFacingError` îl traduce ca până acum. Reîncercările la 503/520 rămân.
 */
export function failFastOnNetworkError(base: typeof fetch): typeof fetch {
  return (input, init) =>
    base(input, init).catch((err: unknown) => {
      if (err && typeof err === 'object' && (err as { name?: unknown }).name !== 'AbortError') {
        const e = err as { code?: unknown };
        if (e.code === undefined) {
          try {
            e.code = 'ABORT_ERR';
          } catch {
            // obiect înghețat: rămâne comportamentul bibliotecii
          }
        }
      }
      throw err;
    });
}
