/**
 * Edge Function: delete-account
 *
 * Auth: JWT of the account being deleted (no body needed).
 * Deletes the auth user with the service role; public.profiles and the
 * rows referencing it are removed by ON DELETE CASCADE. Business owners
 * lose their business profiles (and cascading business data) as well.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

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
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    return jsonResponse({ error: 'delete_failed', detail: delErr.message }, 500);
  }

  return jsonResponse({ ok: true });
});
