/**
 * Run: npx tsx lib/teamAccess.test.ts
 * from apps/mobile
 */
import {
  canInviteRole,
  canManageBusinessSettings,
  canManageTeam,
  canSeeClientsAndReports,
  formatInviteDate,
  isBusinessPathBlocked,
  isInviteExpired,
  roleRank,
  type BusinessRole,
} from './teamAccess';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.error(`  FAIL  ${name}`); }
}

console.log('teamAccess tests\n');

assert(roleRank('owner') > roleRank('admin'), 'owner peste admin');
assert(roleRank('admin') > roleRank('staff'), 'admin peste staff');
assert(roleRank(null) === 0 && roleRank(undefined) === 0, 'fara rol = 0');
assert(roleRank('client' as BusinessRole) === 0, 'rol necunoscut = 0');

assert(canSeeClientsAndReports('owner') && canSeeClientsAndReports('admin'), 'owner/admin vad clienti si rapoarte');
assert(!canSeeClientsAndReports('staff'), 'staff nu vede clienti/rapoarte');

assert(canManageTeam('owner') && canManageTeam('admin'), 'owner/admin gestioneaza echipa');
assert(!canManageTeam('staff'), 'staff nu gestioneaza echipa');
assert(canInviteRole('owner', 'admin') && canInviteRole('owner', 'staff'), 'owner invita admin si staff');
assert(!canInviteRole('admin', 'admin') && canInviteRole('admin', 'staff'), 'admin invita doar staff');
assert(!canInviteRole('staff', 'staff'), 'staff nu invita');

assert(canManageBusinessSettings('owner') && canManageBusinessSettings('admin'), 'owner/admin setari business');
assert(!canManageBusinessSettings('staff'), 'staff fara setari business');

assert(isBusinessPathBlocked('staff', '/business/services'), 'staff nu deschide servicii');
assert(isBusinessPathBlocked('staff', '/business/clients'), 'staff nu deschide clienti');
assert(isBusinessPathBlocked('staff', '/business/chat/abc'), 'staff nu deschide chatul salonului');
assert(!isBusinessPathBlocked('staff', '/business'), 'staff vede acasa');
assert(!isBusinessPathBlocked('staff', '/business/calendar'), 'staff vede calendarul');
assert(!isBusinessPathBlocked('staff', '/business/requests'), 'staff vede cererile');
assert(!isBusinessPathBlocked('staff', '/business/settings'), 'staff vede setarile contului');
assert(!isBusinessPathBlocked('admin', '/business/services'), 'adminul deschide servicii');
assert(!isBusinessPathBlocked(null, '/business/services'), 'rol necunoscut: nu blocam (RLS decide)');

assert(formatInviteDate('2026-11-04T10:00:00Z', 'ro').includes('2026'), 'data expirarii are anul');
assert(formatInviteDate('nu-e-data', 'ro') === 'nu-e-data', 'data invalida ramane textul');
assert(isInviteExpired('2026-01-01T00:00:00Z', new Date('2026-02-01T00:00:00Z')), 'invitatie expirata');
assert(!isInviteExpired('2026-03-01T00:00:00Z', new Date('2026-02-01T00:00:00Z')), 'invitatie valabila');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
