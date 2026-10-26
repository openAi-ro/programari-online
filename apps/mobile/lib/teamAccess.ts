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

/** Owner și admin văd toate programările; staff vede doar programările specialistului legat. */
export function canSeeAllAppointments(role: BusinessRole | string | null | undefined): boolean {
  return roleRank(role) >= RANKS.admin;
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

export function canManageBusinessSettings(role: BusinessRole | string | null | undefined): boolean {
  return roleRank(role) >= RANKS.admin;
}
