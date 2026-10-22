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

// ---------------------------------------------------------------------------
// HTTP cu reîncercare: 429 / 5xx / 403 rateLimitExceeded / erori de rețea.
// ---------------------------------------------------------------------------

export type FetchOpts = {
  retries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function isRetryable(res: Response): Promise<boolean> {
  if (res.status === 429 || res.status >= 500) return true;
  if (res.status === 403) {
    const text = await res.clone().text().catch(() => '');
    return /rateLimitExceeded|userRateLimitExceeded/.test(text);
  }
  return false;
}

export async function googleFetch(url: string, init: RequestInit, opts: FetchOpts = {}): Promise<Response> {
  const retries = opts.retries ?? 3;
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    let res: Response;
    try {
      res = await f(url, init);
    } catch (e) {
      if (attempt >= retries) throw e;
      await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200));
      continue;
    }
    if (attempt >= retries || !(await isRetryable(res))) return res;
    await res.body?.cancel().catch(() => {});
    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 8000)
      : 400 * 2 ** attempt;
    await sleep(wait + Math.floor(Math.random() * 200));
  }
}

/** Eroare Google cu status HTTP (401 → token expirat, 410 → syncToken expirat etc.). */
export class GoogleApiError extends Error {
  constructor(public status: number, op: string) {
    super(`google_${op}_failed_${status}`);
  }
}

// ---------------------------------------------------------------------------
// OAuth tokens
// ---------------------------------------------------------------------------

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
};

async function tokenRequest(body: Record<string, string>, opts: FetchOpts = {}): Promise<TokenResponse> {
  const res = await googleFetch(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    },
    opts
  );
  try {
    return (await res.json()) as TokenResponse;
  } catch {
    return { error: `token_http_${res.status}` };
  }
}

function expiryFrom(expiresIn: number | undefined): Date {
  const secs = Number.isFinite(expiresIn) && (expiresIn ?? 0) > 0 ? expiresIn! : 3600;
  return new Date(Date.now() + secs * 1000);
}

export async function exchangeCode(
  env: { clientId: string; clientSecret: string; redirectUri: string },
  code: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date } | { error: string }> {
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
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expiryFrom(data.expires_in),
  };
}

export type RefreshResult =
  | { ok: true; accessToken: string; expiresAt: Date }
  | { ok: false; error: string; invalidGrant: boolean };

export async function refreshAccessToken(
  env: { clientId: string; clientSecret: string },
  refreshToken: string,
  opts: FetchOpts = {}
): Promise<RefreshResult> {
  const data = await tokenRequest(
    {
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: 'refresh_token',
    },
    opts
  );
  if (data.access_token) {
    return { ok: true, accessToken: data.access_token, expiresAt: expiryFrom(data.expires_in) };
  }
  const error = data.error ?? 'token_refresh_failed';
  return { ok: false, error, invalidGrant: error === 'invalid_grant' };
}

/** Tokenul din cache e folosit doar dacă mai are cel puțin 2 minute. */
export function isTokenFresh(expiresAt: string | null | undefined, nowMs = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t - nowMs > 120_000;
}

// ---------------------------------------------------------------------------
// Events API
// ---------------------------------------------------------------------------

export type GoogleEvent = {
  id: string;
  summary?: string;
  status?: string;
  /** 'transparent' = marcat Disponibil in Google; nu blocheaza. */
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

/** syncToken-ul a expirat (HTTP 410): e nevoie de o sincronizare completă. */
export class SyncTokenExpiredError extends Error {
  constructor() {
    super('google_sync_token_expired');
  }
}

const API = 'https://www.googleapis.com/calendar/v3/calendars';
const calUrl = (calendarId: string) => `${API}/${encodeURIComponent(calendarId)}/events`;

/**
 * Listare completă (timeMin/timeMax) sau incrementală (syncToken).
 * Fără orderBy: nu e permis cu syncToken, iar parametrii trebuie să fie aceiași.
 */
export async function listEvents(
  accessToken: string,
  calendarId: string,
  q: { syncToken?: string | null; timeMin?: string; timeMax?: string },
  opts: FetchOpts = {}
): Promise<{ items: GoogleEvent[]; nextSyncToken: string | null }> {
  const out: GoogleEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });
    if (q.syncToken) {
      params.set('syncToken', q.syncToken);
    } else {
      if (q.timeMin) params.set('timeMin', q.timeMin);
      if (q.timeMax) params.set('timeMax', q.timeMax);
    }
    if (pageToken) params.set('pageToken', pageToken);
    const res = await googleFetch(
      `${calUrl(calendarId)}?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      opts
    );
    if (res.status === 410 && q.syncToken) {
      await res.body?.cancel().catch(() => {});
      throw new SyncTokenExpiredError();
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new GoogleApiError(res.status, 'list');
    }
    const data = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    out.push(...(data.items ?? []));
    if (!data.nextPageToken) return { items: out, nextSyncToken: data.nextSyncToken ?? null };
    pageToken = data.nextPageToken;
  }
  // Prea multe pagini: păstrăm ce avem, dar fără token nou (următoarea rulare reia complet).
  return { items: out, nextSyncToken: null };
}

async function send(
  accessToken: string,
  url: string,
  method: string,
  body: unknown,
  opts: FetchOpts
): Promise<Response> {
  return await googleFetch(
    url,
    {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    opts
  );
}

/**
 * ID determinist pentru evenimentul unei programări: 'prg' + uuid fără liniuțe.
 * Caracterele (0-9, a-f, p, r, g) sunt valide în base32hex, deci Google îl acceptă,
 * iar o reîncercare nu poate crea un al doilea eveniment.
 */
export function appointmentEventId(appointmentId: string): string {
  return `prg${appointmentId.toLowerCase().replace(/-/g, '')}`;
}

export function isAppointmentEventId(eventId: string): boolean {
  return /^prg[0-9a-f]{32}$/.test(eventId);
}

/**
 * Creează sau actualizează evenimentul unei programări; întoarce id-ul folosit.
 * - legătură existentă → PATCH (status confirmed reface și un eveniment șters);
 * - altfel insert cu id determinist; 409 (există deja / șters anterior) → PATCH.
 */
export async function upsertAppointmentEvent(
  accessToken: string,
  calendarId: string,
  appointmentId: string,
  existingEventId: string | null,
  body: Record<string, unknown>,
  opts: FetchOpts = {}
): Promise<string> {
  const patchBody = { ...body, status: 'confirmed' };
  const patch = async (id: string) => {
    const res = await send(accessToken, `${calUrl(calendarId)}/${encodeURIComponent(id)}`, 'PATCH', patchBody, opts);
    await res.body?.cancel().catch(() => {});
    return res.status;
  };
  if (existingEventId) {
    const st = await patch(existingEventId);
    if (st >= 200 && st < 300) return existingEventId;
    if (st !== 404 && st !== 410) throw new GoogleApiError(st, 'update');
  }
  const id = appointmentEventId(appointmentId);
  const res = await send(accessToken, calUrl(calendarId), 'POST', { ...body, id }, opts);
  await res.body?.cancel().catch(() => {});
  if (res.ok) return id;
  if (res.status !== 409) throw new GoogleApiError(res.status, 'create');
  const st = await patch(id);
  if (st >= 200 && st < 300) return id;
  throw new GoogleApiError(st, 'update');
}

export async function deleteEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  opts: FetchOpts = {}
): Promise<void> {
  const res = await send(accessToken, `${calUrl(calendarId)}/${encodeURIComponent(eventId)}`, 'DELETE', undefined, opts);
  await res.body?.cancel().catch(() => {});
  // 404/410 înseamnă că evenimentul nu mai există — scopul e atins.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new GoogleApiError(res.status, 'delete');
  }
}

// ---------------------------------------------------------------------------
// Helpers puri (testate)
// ---------------------------------------------------------------------------

/** Rulează fn pe items cu cel mult `limit` cereri simultane; rezultatele păstrează ordinea. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
  return results;
}

/** Miezul nopții local (YYYY-MM-DD) într-un fus orar → instant UTC. */
export function zonedDayStartUtc(dateYmd: string, timeZone: string): Date {
  const dayMs = Date.parse(`${dateYmd}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const offsetAt = (utcMs: number): number => {
    const parts = fmt.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc =
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUtc - utcMs;
  };
  // Două treceri: offsetul la miezul nopții UTC, apoi la instantul ghicit
  // (corect și în zilele cu schimbare de oră).
  const guess = dayMs - offsetAt(dayMs);
  return new Date(dayMs - offsetAt(guess));
}

export function addDaysYmd(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export type BusyBlock = {
  business_id: string;
  google_event_id: string;
  start_at: string;
  end_at: string;
  updated_at: string;
};

/**
 * Evenimentul Google → blocare (sau null dacă nu blochează: anulat, „Disponibil”,
 * eveniment al aplicației, fără interval valid).
 */
export function eventToBlock(
  ev: GoogleEvent,
  businessId: string,
  timeZone: string,
  isOwn: (id: string) => boolean,
  nowIso = new Date().toISOString()
): BusyBlock | null {
  if (ev.status === 'cancelled' || ev.transparency === 'transparent') return null;
  if (isOwn(ev.id)) return null;
  if (ev.start?.dateTime && ev.end?.dateTime) {
    return {
      business_id: businessId,
      google_event_id: ev.id,
      start_at: ev.start.dateTime,
      end_at: ev.end.dateTime,
      updated_at: nowIso,
    };
  }
  // Evenimente de o zi întreagă (concedii, zile libere): blochează zilele întregi.
  if (ev.start?.date && !ev.start.dateTime) {
    const startDay = ev.start.date;
    const endDay = ev.end?.date ?? addDaysYmd(startDay, 1);
    const startMs = zonedDayStartUtc(startDay, timeZone).getTime();
    const endMs = zonedDayStartUtc(endDay, timeZone).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return {
      business_id: businessId,
      google_event_id: ev.id,
      start_at: new Date(startMs).toISOString(),
      end_at: new Date(endMs).toISOString(),
      updated_at: nowIso,
    };
  }
  return null;
}

export type AppointmentForEvent = {
  id: string;
  start_at: string;
  end_at: string;
  service_name: string | null;
  client_email: string | null;
  client_phone: string | null;
};

export function appointmentEventBody(
  apt: AppointmentForEvent,
  businessName: string,
  timeZone: string
): Record<string, unknown> {
  return {
    summary: `${businessName}: ${apt.service_name ?? 'Programare'}`,
    description: [apt.client_email, apt.client_phone].filter(Boolean).join(' '),
    start: { dateTime: apt.start_at, timeZone },
    end: { dateTime: apt.end_at, timeZone },
    extendedProperties: { private: { programari_appointment_id: apt.id } },
  };
}
