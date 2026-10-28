/**
 * Run: npx tsx lib/teamErrors.test.ts
 * from apps/mobile
 */
import { ro } from './locales/ro';
import { en } from './locales/en';
import { teamErrorCode, teamErrorKey } from './teamErrors';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string) {
  if (cond) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.error(`  FAIL  ${name}`); }
}

console.log('teamErrors tests\n');

assert(teamErrorCode('invalid_email') === 'invalid_email', 'cod simplu');
assert(teamErrorCode('ERROR: staff_required (P0001)') === 'staff_required', 'cod in text');
assert(teamErrorCode('only_owner_manages_admin') === 'only_owner_manages_admin', 'nu confunda prefixele');
assert(teamErrorCode('Failed to fetch') === null, 'eroare necunoscuta');
assert(teamErrorKey(null) === 'teamErr.generic', 'fara cod -> generic');
assert(teamErrorKey('resend_too_soon') === 'teamErr.resend_too_soon', 'cheie i18n');

const codes = [
  'invalid_email', 'already_member', 'only_owner_invites_admin', 'only_owner_manages_admin',
  'staff_already_linked', 'invitation_expired', 'invitation_not_found', 'staff_not_found',
  'staff_required', 'email_mismatch', 'resend_too_soon', 'cannot_invite_owner',
  'cannot_change_owner', 'cannot_remove_owner', 'member_not_found', 'not_allowed',
  'not_business_member', 'not_authenticated', 'email_failed',
];
for (const c of codes) {
  const key = teamErrorKey(c);
  assert(key === `teamErr.${c}` && Boolean(ro[key]) && Boolean(en[key]), `traducere ro/en pentru ${c}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
