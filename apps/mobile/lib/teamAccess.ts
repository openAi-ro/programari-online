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

/** Ecranele din /business pe care angajatul (staff) nu le poate deschide nici din link direct. */
const OWNER_ADMIN_SCREENS = [
  'setup',
  'services',
  'staff',
  'packages',
  'page',
  'booking-button',
  'reviews',
  'waitlist',
  'chat',
  'clients',
  'reports',
];

/** true dacă rolul nu are voie pe ruta din /business (pathname Expo Router, ex. „/business/services”). */
export function isBusinessPathBlocked(
  role: BusinessRole | string | null | undefined,
  pathname: string,
): boolean {
  if (!role || canManageBusinessSettings(role)) return false;
  const parts = pathname.split('?')[0].split('/').filter(Boolean);
  const i = parts.indexOf('business');
  const screen = i >= 0 ? parts[i + 1] : undefined;
  return screen !== undefined && OWNER_ADMIN_SCREENS.includes(screen);
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
