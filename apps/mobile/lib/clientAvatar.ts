/** Cercul cu poza clientului (Cereri): inițiale și culoare stabilă când nu există poză. */

/** 1–2 inițiale din nume („Ana Maria Pop” → „AP”, „ion” → „I”); fără litere → null (iconiță). */
export function clientInitials(name: string | null | undefined): string | null {
  const words = (name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return null;
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toLocaleUpperCase('ro-RO');
}

/** Culori pentru fundalul inițialelor, toate cu contrast bun pe text alb (deschis și întunecat). */
export const AVATAR_COLORS = [
  '#2563eb',
  '#0f766e',
  '#7c3aed',
  '#b45309',
  '#be185d',
  '#15803d',
  '#4338ca',
  '#0e7490',
] as const;

/** Aceeași persoană primește mereu aceeași culoare (hash FNV-1a pe id / nume). */
export function avatarColor(seed: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** Id-urile unice de clienți cu cont dintr-o listă de programări. */
export function clientIdsOf(rows: readonly { client_user_id?: string | null }[]): string[] {
  return [...new Set(rows.map((r) => r.client_user_id).filter((id): id is string => Boolean(id)))];
}
