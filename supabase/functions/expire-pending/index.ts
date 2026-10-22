/**
 * Edge Function: expire-pending
 *
 * Cron hourly: cancel pending appointments older than 24 hours.
 * Frees the slot (pending no longer blocks).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { authorizeCron } from '../_shared/secret-auth.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const cronAuth = authorizeCron(req);
  if (!cronAuth.ok) {
    return jsonResponse({ error: cronAuth.error }, cronAuth.status);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('appointments')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id');

  if (error) {
    console.error('expire-pending failed', error);
    return jsonResponse({ error: error.message }, 500);
  }

  const cancelled = data?.length ?? 0;
  console.log('expire-pending cancelled', cancelled, 'cutoff', cutoff);

  return jsonResponse({
    ok: true,
    cutoff,
    cancelled,
    ids: (data ?? []).map((r) => r.id),
  });
});
