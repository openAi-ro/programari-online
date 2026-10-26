/**
 * Run: npx tsx lib/teamAccess.test.ts
 * from apps/mobile
 */
import {
  canInviteRole,
  canManageBusinessSettings,
  canManageTeam,
  canSeeAllAppointments,
  canSeeClientsAndReports,
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

assert(canSeeAllAppointments('owner') && canSeeAllAppointments('admin'), 'owner/admin vad toate programarile');
assert(!canSeeAllAppointments('staff') && !canSeeAllAppointments(null), 'staff/ne-membru nu vad toate programarile');

assert(canSeeClientsAndReports('owner') && canSeeClientsAndReports('admin'), 'owner/admin vad clienti si rapoarte');
assert(!canSeeClientsAndReports('staff'), 'staff nu vede clienti/rapoarte');

assert(canManageTeam('owner') && canManageTeam('admin'), 'owner/admin gestioneaza echipa');
assert(!canManageTeam('staff'), 'staff nu gestioneaza echipa');
assert(canInviteRole('owner', 'admin') && canInviteRole('owner', 'staff'), 'owner invita admin si staff');
assert(!canInviteRole('admin', 'admin') && canInviteRole('admin', 'staff'), 'admin invita doar staff');
assert(!canInviteRole('staff', 'staff'), 'staff nu invita');

assert(canManageBusinessSettings('owner') && canManageBusinessSettings('admin'), 'owner/admin setari business');
assert(!canManageBusinessSettings('staff'), 'staff fara setari business');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
