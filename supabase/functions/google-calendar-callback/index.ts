/**
 * Edge Function: google-calendar-callback
 * Redirect Google OAuth (GET ?code&state). Fără JWT: state-ul e semnat HMAC.
 * Salvează refresh token-ul (doar service role îl poate citi ulterior) și pornește
 * imediat prima sincronizare în fundal, fără să întârzie redirectul.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { exchangeCode, googleEnv, verifyState } from '../_shared/googleCalendar.ts';

// Supabase rescrie răspunsurile GET text/html în text/plain pe domeniul implicit,
// deci nu servim pagină aici: redirecționăm spre pagina aplicației.
const APP_WEB = (Deno.env.get('PUBLIC_WEB_BASE_URL') ?? 'https://programari.expo.app').replace(/\/$/, '');

function backToApp(status: 'ok' | 'error', reason?: string): Response {
  const q = new URLSearchParams({ status });
  if (reason) q.set('reason', reason);
  return new Response(null, {
    status: 302,
    headers: { Location: `${APP_WEB}/gcal-connected?${q.toString()}`, 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';

  const env = googleEnv();
  if (!env) return backToApp('error', 'config');

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return backToApp('error', 'server');

  const verified = await verifyState(serviceKey, state);
  if (!code || !verified) return backToApp('error', 'state');

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: business } = await admin
    .from('business_profiles')
    .select('id, owner_user_id')
    .eq('id', verified.businessId)
    .maybeSingle();
  if (!business || business.owner_user_id !== verified.userId) {
    return backToApp('error', 'business');
  }

  const tokens = await exchangeCode(env, code);
  if ('error' in tokens) return backToApp('error', 'auth');

  // Reconectare = conexiune nouă: starea, tokenul de sincronizare și cache-ul se resetează.
  const { error } = await admin.from('google_calendar_connections').upsert({
    business_id: verified.businessId,
    google_calendar_id: 'primary',
    refresh_token: tokens.refreshToken,
    connected_at: new Date().toISOString(),
    status: 'active',
    last_error: null,
    sync_token: null,
    full_synced_at: null,
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.expiresAt.toISOString(),
  });
  if (error) return backToApp('error', 'save');

  runInBackground(firstSync(supabaseUrl, verified.businessId));
  return backToApp('ok');
});

/** Prima sincronizare prin google-calendar-sync (aceeași cale ca pg_cron). */
async function firstSync(supabaseUrl: string, businessId: string): Promise<void> {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret) {
    console.error('first sync skipped: CRON_SECRET not configured');
    return;
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/google-calendar-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
      body: JSON.stringify({ business_id: businessId }),
    });
    await res.body?.cancel().catch(() => {});
    if (!res.ok) console.error('first sync failed', res.status);
  } catch (e) {
    console.error('first sync failed', e instanceof Error ? e.message : e);
  }
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

function runInBackground(p: Promise<void>): void {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
  else void p;
}
