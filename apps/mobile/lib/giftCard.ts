/** Cod de card cadou fără cratime/spații, majuscule (forma stocată în DB). */
export function normalizeGiftCode(code: string): string {
  return (code ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Forma afișată clientului: ABCD-1234-EFGH-5678. */
export function formatGiftCode(code: string): string {
  const raw = normalizeGiftCode(code);
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export function isValidGiftAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0;
}

/**
 * Folosește o sumă din card. Întoarce soldul nou sau null dacă
 * suma e invalidă sau peste sold.
 */
export function applyGiftRedemption(balance: number, amount: number): number | null {
  if (!isValidGiftAmount(amount) || !Number.isFinite(balance) || balance < 0) return null;
  if (balance <= 0 || amount > balance) return null;
  return Math.round((balance - amount) * 100) / 100;
}

/** Cod nou, din caractere fără ambiguități (fără 0/O, 1/I). */
export function generateGiftCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let raw = '';
  for (let i = 0; i < 16; i += 1) {
    raw += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  }
  return raw;
}
