/**
 * Run: npx tsx lib/auth-link.test.ts
 * from apps/mobile
 */
import { pickAuthCallbackUrl, stashAuthCallbackUrl, takeAuthCallbackUrl } from './auth-link';

let passed = 0;
let failed = 0;
function assert(cond: boolean, name: string, detail?: string) {
  if (cond) passed += 1;
  else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
}
const isCb = (u: string) => u.toLowerCase().includes('auth/callback') || u.includes('access_token=');

const deep = 'programari://auth/callback#access_token=a&refresh_token=b&provider_token=x';
assert(
  pickAuthCallbackUrl({ platform: 'android', webHref: null, linkUrl: deep, isCallback: isCb }) === deep,
  'android: deep link-ul Google cu tokenuri',
);
assert(
  pickAuthCallbackUrl({ platform: 'ios', webHref: null, linkUrl: 'programari://auth/callback?code=c1', isCallback: isCb }) ===
    'programari://auth/callback?code=c1',
  'ios: deep link cu code',
);
assert(
  pickAuthCallbackUrl({ platform: 'android', webHref: 'https://x/auth/callback#t', linkUrl: deep, isCallback: isCb }) === deep,
  'nativ ignoră orice href web',
);
assert(
  pickAuthCallbackUrl({ platform: 'android', webHref: null, linkUrl: null, isCallback: isCb }) === null,
  'nativ fără link -> null (ecranul citește sesiunea)',
);
const web = 'https://programari.expo.app/auth/callback#access_token=a&refresh_token=b&type=signup';
assert(
  pickAuthCallbackUrl({ platform: 'web', webHref: web, linkUrl: null, isCallback: isCb }) === web,
  'web: adresa din bară (activare email / Google)',
);
assert(
  pickAuthCallbackUrl({ platform: 'web', webHref: 'https://programari.expo.app/home', linkUrl: 'https://l/auth/callback?code=z', isCallback: isCb }) ===
    'https://l/auth/callback?code=z',
  'web: bara nu e callback -> link-ul',
);

// Simulare React Native: window există, window.location nu.
const g = globalThis as unknown as { window?: unknown };
const prev = g.window;
g.window = {};
let threw = false;
try {
  pickAuthCallbackUrl({ platform: 'android', webHref: null, linkUrl: deep, isCallback: isCb });
} catch {
  threw = true;
}
g.window = prev;
assert(!threw, 'nativ cu window fără location nu aruncă');

stashAuthCallbackUrl(deep);
assert(takeAuthCallbackUrl() === deep && takeAuthCallbackUrl() === null, 'stash se consumă o singură dată');

console.log(`auth-link: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);