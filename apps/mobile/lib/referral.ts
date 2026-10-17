export type ReferralStatus = 'pending' | 'rewarded';

/** Cod de recomandare din 6 caractere, fără ambiguități (fără 0/O, 1/I). */
export function makeReferralCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  }
  return code;
}

/** Forma stocată/căutată în DB: majuscule, fără separatori. */
export function normalizeReferralCode(code: string): string {
  return (code ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/** Tranziție de stare: recompensa vine o singură dată, la prima vizită aprobată. */
export function nextReferralStatus(current: ReferralStatus, hasApprovedVisit: boolean): ReferralStatus {
  if (current === 'rewarded') return 'rewarded';
  return hasApprovedVisit ? 'rewarded' : 'pending';
}
