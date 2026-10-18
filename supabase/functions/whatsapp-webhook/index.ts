/**
 * Edge Function: whatsapp-webhook  (deploy with --no-verify-jwt; Meta calls it unauthenticated)
 *
 * GET  — Meta verification handshake: hub.mode=subscribe & hub.verify_token must equal
 *        secret WHATSAPP_WEBHOOK_VERIFY_TOKEN; replies with hub.challenge.
 * POST — message status updates (sent/delivered/read/failed + error codes such as
 *        131047 24h window, 131030 recipient not allowed). When WHATSAPP_APP_SECRET is set,
 *        X-Hub-Signature-256 is verified. Updates public.notification_log by wamid.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  extractStatuses,
  shouldApplyStatus,
  verifyMetaSignature,
} from '../_shared/whatsappWebhook.ts';

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    const expected = Deno.env.get('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    if (!expected) {
      console.error('whatsapp-webhook: WHATSAPP_WEBHOOK_VERIFY_TOKEN not set');
      return new Response('verify token not configured', { status: 403 });
    }
    if (mode === 'subscribe' && token === expected) {
      return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const raw = await req.text();
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (appSecret) {
    const ok = await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), appSecret);
    if (!ok) {
      console.error('whatsapp-webhook: bad signature');
      return new Response('invalid signature', { status: 401 });
    }
  } else {
    console.warn('whatsapp-webhook: WHATSAPP_APP_SECRET not set — signature not verified');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const updates = extractStatuses(payload);
  if (!updates.length) return new Response('ok', { status: 200 });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return new Response('server misconfigured', { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceKey);

  let applied = 0;
  for (const u of updates) {
    const { data: row } = await admin
      .from('notification_log')
      .select('id, status')
      .eq('wamid', u.wamid)
      .maybeSingle();
    if (!row) continue; // not sent by us (or sent before logging existed)
    if (!shouldApplyStatus((row as { status?: string }).status, u.status)) continue;
    const patch: Record<string, unknown> = { status: u.status, updated_at: new Date().toISOString() };
    if (u.status === 'failed') {
      patch.error_code = u.errorCode;
      patch.error_message = u.errorMessage;
      console.error('WhatsApp delivery failed', u.wamid, u.errorCode, u.errorMessage);
    }
    const { error } = await admin.from('notification_log').update(patch).eq('id', (row as { id: string }).id);
    if (error) console.error('notification_log update failed', error.message);
    else applied++;
  }

  // Always 200 so Meta does not retry endlessly.
  return new Response(JSON.stringify({ ok: true, received: updates.length, applied }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
