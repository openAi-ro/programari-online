/**
 * Edge Function: google-calendar-connect
 * Body: { business_id }
 * Auth: JWT al proprietarului firmei.
 * Întoarce URL-ul de autorizare Google (state semnat, fără JWT în callback).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { buildAuthUrl, googleEnv, signState } from '../_shared/googleCalendar.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const env = googleEnv();
  if (!env) return jsonResponse({ error: 'google_not_configured' }, 500);

  let payload: { business_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const businessId = payload.business_id ?? '';
  if (!businessId) return jsonResponse({ error: 'invalid_payload' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return jsonResponse({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: business } = await admin
    .from('business_profiles')
    .select('id, owner_user_id')
    .eq('id', businessId)
    .maybeSingle();
  if (!business) return jsonResponse({ error: 'business_not_found' }, 404);
  if (business.owner_user_id !== user.id) return jsonResponse({ error: 'forbidden' }, 403);

  const state = await signState(serviceKey, businessId, user.id);
  return jsonResponse({ ok: true, url: buildAuthUrl(env.clientId, env.redirectUri, state) });
});
