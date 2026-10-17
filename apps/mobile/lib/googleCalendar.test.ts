/**
 * Run: npx tsx lib/googleCalendar.test.ts
 * from apps/mobile
 */
import {
  GOOGLE_CALENDAR_SCOPES,
  buildGoogleAuthUrl,
  isGoogleConnected,
} from './googleCalendar';

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

const url = buildGoogleAuthUrl({
  clientId: 'client-123',
  redirectUri: 'https://example.supabase.co/functions/v1/google-calendar-callback',
  state: 'biz-1',
});
assert(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?'), 'URL de autorizare Google', url);
assert(url.includes('client_id=client-123'), 'client_id în URL');
assert(url.includes('access_type=offline'), 'access offline pentru refresh token');
assert(url.includes('prompt=consent'), 'consimțământ cerut explicit');
assert(
  new URL(url).searchParams.get('scope') === GOOGLE_CALENDAR_SCOPES.join(' '),
  'scope-urile de calendar cerute',
  new URL(url).searchParams.get('scope') ?? '',
);
assert(url.includes('state=biz-1'), 'state cu business-ul');

assert(
  buildGoogleAuthUrl({ clientId: ' ', redirectUri: 'https://x', state: 'b' }) === '',
  'fără client_id → URL gol',
);
assert(
  buildGoogleAuthUrl({ clientId: 'c', redirectUri: '', state: 'b' }) === '',
  'fără redirect → URL gol',
);

assert(isGoogleConnected({ google_calendar_id: 'primary', connected_at: '2026-10-18' }) === true, 'conectat');
assert(isGoogleConnected({ google_calendar_id: null, connected_at: null }) === false, 'neconectat');
assert(isGoogleConnected(null) === false, 'fără rând → neconectat');
assert(isGoogleConnected(undefined) === false, 'undefined → neconectat');

console.log(`googleCalendar: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
