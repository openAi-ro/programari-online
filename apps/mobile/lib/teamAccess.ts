/** Roluri de membru într-un business (v89: business_members). */
export type BusinessRole = 'owner' | 'admin' | 'staff';

const RANKS: Record<string, number> = { staff: 1, admin: 2, owner: 3 };

export function roleRank(role: BusinessRole | string | null | undefined): number {
  if (!role) return 0;
  return RANKS[role] ?? 0;
}

export function isBusinessRole(value: unknown): value is BusinessRole {
  return value === 'owner' || value === 'admin' || value === 'staff';
}

/** Baza de clienți și rapoartele financiare: doar owner/admin, niciodată staff. */
export function canSeeClientsAndReports(role: BusinessRole | string | null | undefined): boolean {
  return roleRank(role) >= RANKS.admin;
}

export function canManageTeam(role: BusinessRole | string | null | undefined): boolean {
  return roleRank(role) >= RANKS.admin;
}

/** Doar ownerul poate crea un alt admin; adminul poate invita doar staff. */
export function canInviteRole(
  actorRole: BusinessRole | string | null | undefined,
  targetRole: BusinessRole | string | null | undefined,
): boolean {
  if (!canManageTeam(actorRole)) return false;
  if (targetRole === 'admin') return actorRole === 'owner';
  return targetRole === 'staff';
}

/** Servicii, specialiști, echipă, profilul/pagina salonului, recenzii, listă de așteptare: owner/admin. */
export function canManageBusinessSettings(role: BusinessRole | string | null | undefined): boolean {
  return roleRank(role) >= RANKS.admin;
}

/** Data de expirare a unei invitații, ex. „4 noiembrie 2026” (ora României). */
export function formatInviteDate(iso: string, lang: 'ro' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ro-RO', {
    timeZone: 'Europe/Bucharest',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function isInviteExpired(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

/** Zona aplicației: client sau business. */
export type AppMode = 'client' | 'business';

function parseMode(value: string | null | undefined): AppMode | null {
  return value === 'client' || value === 'business' ? value : null;
}

/**
 * Singura regulă pentru zona (client / business) în care intră contul:
 * - account_kind = business (sau, fără account_kind, cine are un business) → business;
 * - un cont de client care e și membru al unei echipe (business_members) alege zona;
 *   alegerea e memorată (setAppMode), implicit business;
 * - restul → client.
 */
export function appModeFrom(
  accountKind: string | null | undefined,
  hasBusiness: boolean,
  stored: AppMode | null = null,
): AppMode {
  const base = parseMode(accountKind) ?? (hasBusiness ? 'business' : 'client');
  if (base === 'business' || !hasBusiness) return base;
  return stored ?? 'business';
}

/** Contul de client care e și în echipa unui business poate comuta între zone. */
export function canSwitchAppMode(accountKind: string | null | undefined, hasBusiness: boolean): boolean {
  const base = parseMode(accountKind) ?? (hasBusiness ? 'business' : 'client');
  return base === 'client' && hasBusiness;
}
