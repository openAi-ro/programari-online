export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * URL de conectare Google Calendar pentru firma dată (state = business_id).
 * Gol dacă lipsesc datele de configurare.
 */
export function buildGoogleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const clientId = opts.clientId.trim();
  const redirectUri = opts.redirectUri.trim();
  if (!clientId || !redirectUri || !opts.state.trim()) return '';
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: opts.state,
  });
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

export type GoogleConnectionLike = {
  google_calendar_id: string | null;
  connected_at: string | null;
} | null | undefined;

export function isGoogleConnected(conn: GoogleConnectionLike): boolean {
  return Boolean(conn?.google_calendar_id && conn?.connected_at);
}
