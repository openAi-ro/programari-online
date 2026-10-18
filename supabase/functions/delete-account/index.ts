/**
 * Edge Function: delete-account
 *
 * Auth: JWT of the account being deleted (no body needed).
 * Deletes the auth user with the service role; public.profiles and the
 * rows referencing it are removed by ON DELETE CASCADE. Business owners
 * lose their business profiles (and cascading business data) as well.
 * Before/after photo files (private bucket 'client-photos') are removed here first.
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

  // Pozele înainte/după din bucket-ul privat: rândurile se șterg în cascadă,
  // fișierele nu — le ștergem aici, înainte de cont (ca un eșec să poată fi reîncercat).
  // 1) pozele contului ca și client  2) pozele clienților business-urilor contului.
  const { data: ownBiz, error: bizErr } = await admin
    .from('business_profiles')
    .select('id')
    .eq('owner_user_id', user.id);
  if (bizErr) return jsonResponse({ error: 'cleanup_failed', detail: bizErr.message }, 500);
  const bizIds = (ownBiz ?? []).map((b: { id: string }) => b.id);
  let photoQuery = admin.from('client_photos').select('storage_path');
  photoQuery = bizIds.length
    ? photoQuery.or(`client_user_id.eq.${user.id},business_id.in.(${bizIds.join(',')})`)
    : photoQuery.eq('client_user_id', user.id);
  const { data: photos, error: photoErr } = await photoQuery;
  if (photoErr) return jsonResponse({ error: 'cleanup_failed', detail: photoErr.message }, 500);
  const paths = (photos ?? []).map((p: { storage_path: string }) => p.storage_path).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    const { error: rmErr } = await admin.storage.from('client-photos').remove(paths.slice(i, i + 100));
    if (rmErr) return jsonResponse({ error: 'cleanup_failed', detail: rmErr.message }, 500);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    return jsonResponse({ error: 'delete_failed', detail: delErr.message }, 500);
  }

  return jsonResponse({ ok: true });
});
