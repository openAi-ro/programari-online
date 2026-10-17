/**
 * Edge Function: google-calendar-callback
 * Redirect Google OAuth (GET ?code&state). Fără JWT: state-ul e semnat HMAC.
 * Salvează refresh token-ul (doar service role îl poate citi ulterior).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { exchangeCode, googleEnv, verifyState } from '../_shared/googleCalendar.ts';

function htmlPage(message: string): Response {
  return new Response(
    `<!doctype html><html lang="ro"><meta charset="utf-8"><title>Google Calendar</title><body style="font-family:system-ui;padding:24px"><p>${message}</p></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';

  const env = googleEnv();
  if (!env) return htmlPage('Configurarea Google lipsește pe server.');

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return htmlPage('Server neconfigurat.');

  const verified = await verifyState(serviceKey, state);
  if (!code || !verified) return htmlPage('Legătura nu a putut fi verificată. Reîncearcă din aplicație.');

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: business } = await admin
    .from('business_profiles')
    .select('id, owner_user_id')
    .eq('id', verified.businessId)
    .maybeSingle();
  if (!business || business.owner_user_id !== verified.userId) {
    return htmlPage('Firma nu a fost găsită pentru acest cont.');
  }

  const tokens = await exchangeCode(env, code);
  if ('error' in tokens) return htmlPage('Autorizarea Google a eșuat. Reîncearcă din aplicație.');

  const { error } = await admin.from('google_calendar_connections').upsert({
    business_id: verified.businessId,
    google_calendar_id: 'primary',
    refresh_token: tokens.refreshToken,
    connected_at: new Date().toISOString(),
  });
  if (error) return htmlPage('Conexiunea nu a putut fi salvată. Reîncearcă din aplicație.');

  return htmlPage('Google Calendar a fost conectat. Te poți întoarce în aplicație.');
});
