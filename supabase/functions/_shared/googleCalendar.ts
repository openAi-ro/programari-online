/** Google Calendar OAuth + API helpers (doar server, chei din env). */

export function googleEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} | null {
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
  const redirectUri = Deno.env.get('GOOGLE_CALENDAR_REDIRECT_URI') ?? '';
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** state semnat: businessId.userId.semnat — callback-ul nu are JWT Supabase. */
export async function signState(secret: string, businessId: string, userId: string): Promise<string> {
  const sig = await hmacHex(secret, `${businessId}.${userId}`);
  return `${businessId}.${userId}.${sig}`;
}

export async function verifyState(
  secret: string,
  state: string
): Promise<{ businessId: string; userId: string } | null> {
  const parts = state.split('.');
  if (parts.length !== 3) return null;
  const [businessId, userId, sig] = parts;
  const expected = await hmacHex(secret, `${businessId}.${userId}`);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i += 1) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { businessId, userId } : null;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  return (await res.json()) as TokenResponse;
}

export async function exchangeCode(
  env: { clientId: string; clientSecret: string; redirectUri: string },
  code: string
): Promise<{ accessToken: string; refreshToken: string } | { error: string }> {
  const data = await tokenRequest({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: 'authorization_code',
  });
  if (!data.access_token || !data.refresh_token) {
    return { error: data.error ?? 'token_exchange_failed' };
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

export async function refreshAccessToken(
  env: { clientId: string; clientSecret: string },
  refreshToken: string
): Promise<string | null> {
  const data = await tokenRequest({
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: 'refresh_token',
  });
  return data.access_token ?? null;
}

export type GoogleEvent = {
  id: string;
  summary?: string;
  status?: string;
  /** 'transparent' = marcat Disponibil in Google; nu blocheaza. */
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

export async function listEvents(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`google_list_failed_${res.status}`);
    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    out.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

export async function createEvent(
  accessToken: string,
  calendarId: string,
  body: Record<string, unknown>
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`google_create_failed_${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function updateEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`google_update_failed_${res.status}`);
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  );
  // 404/410 înseamnă că evenimentul nu mai există — scopul e atins.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`google_delete_failed_${res.status}`);
  }
}
