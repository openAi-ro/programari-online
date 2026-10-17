/**
 * Run: npx tsx lib/googleAuth.test.ts
 * from apps/mobile
 */
import {
  googleRedirectTo,
  isFreshSignup,
  isGoogleUser,
  resolveGoogleAccountKind,
} from './googleAuth';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string, detail?: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}

assert(
  googleRedirectTo('web', 'https://programari.expo.app') ===
    'https://programari.expo.app/auth/callback',
  'web → callback https al aplicației',
  googleRedirectTo('web', 'https://programari.expo.app'),
);
assert(
  googleRedirectTo('android', 'https://programari.expo.app') === 'programari://auth/callback',
  'nativ → schema aplicației',
  googleRedirectTo('android', ''),
);
assert(
  googleRedirectTo('ios', '') === 'programari://auth/callback',
  'ios fără origine web → schema aplicației',
);

assert(
  resolveGoogleAccountKind({
    metadataKind: 'business',
    pendingKind: 'client',
    profileKind: null,
  }) === 'business',
  'metadata contului are prioritate',
);
assert(
  resolveGoogleAccountKind({
    metadataKind: null,
    pendingKind: 'business',
    profileKind: null,
  }) === 'business',
  'fără metadata → ușa aleasă (pending)',
);
assert(
  resolveGoogleAccountKind({
    metadataKind: null,
    pendingKind: null,
    profileKind: 'business',
  }) === 'business',
  'fără pending → rolul deja salvat în profil',
);
assert(
  resolveGoogleAccountKind({
    metadataKind: null,
    pendingKind: 'business',
    profileKind: 'client',
  }) === 'client',
  'profilul existent NU se răsturnează după ușă',
);
assert(
  resolveGoogleAccountKind({
    metadataKind: undefined,
    pendingKind: undefined,
    profileKind: undefined,
  }) === 'client',
  'nimic cunoscut → client (implicit)',
);

assert(
  isGoogleUser({ app_metadata: { provider: 'google' } }) === true,
  'provider principal google',
);
assert(
  isGoogleUser({
    identities: [{ provider: 'email' }, { provider: 'google' }],
  }) === true,
  'identitate google legată ulterior',
);
assert(isGoogleUser({ app_metadata: { provider: 'email' } }) === false, 'doar email → nu');
assert(isGoogleUser(null) === false, 'utilizator lipsă → nu');
assert(isGoogleUser(undefined) === false, 'undefined → nu');

assert(
  isFreshSignup({ created_at: '2026-10-17T12:00:00Z', last_sign_in_at: '2026-10-17T12:00:01Z' }) === true,
  'cont creat acum (primul login Google) -> nou',
);
assert(
  isFreshSignup({ created_at: '2026-09-01T12:00:00Z', last_sign_in_at: '2026-10-17T12:00:00Z' }) === false,
  'cont vechi -> nu e nou',
);
assert(isFreshSignup({ created_at: '2026-10-17T12:00:00Z' }) === true, 'fara last_sign_in -> nou');
assert(isFreshSignup(null) === false, 'fara utilizator -> nu');

console.log(`googleAuth: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
