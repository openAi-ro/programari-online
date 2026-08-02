/**
 * Edge Function: notify-pending-push
 *
 * Trigger: Database Webhook on INSERT into public.appointments
 * (or manual POST with { record: appointmentRow }).
 *
 * Loads business owner push tokens and sends Expo Push notifications.
 *
 * Webhook setup (Dashboard → Database → Webhooks):
 *   Table: appointments
 *   Events: INSERT
 *   URL: https://<project-ref>.supabase.co/functions/v1/notify-pending-push
 *   Headers: Authorization: Bearer <SERVICE_ROLE_OR_ANON>, optional x-webhook-secret
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { corsHeaders, handleCors, jsonResponse } from '../_shared/cors.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type AppointmentRow = {
  id: string;
  business_id: string;
  status: string;
  client_email?: string | null;
  client_phone?: string | null;
  start_at?: string;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: AppointmentRow;
  // allow direct body with appointment fields
  id?: string;
  business_id?: string;
  status?: string;
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (webhookSecret) {
    const header = req.headers.get('x-webhook-secret');
    if (header !== webhookSecret) {
      return jsonResponse({ error: 'unauthorized' }, 401);
    }
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const record: AppointmentRow | undefined =
    payload.record ??
    (payload.id && payload.business_id
      ? {
          id: payload.id,
          business_id: payload.business_id,
          status: payload.status ?? 'pending',
        }
      : undefined);

  if (!record?.id || !record.business_id) {
    return jsonResponse({ error: 'missing_record' }, 400);
  }

  if (record.status && record.status !== 'pending') {
    return jsonResponse({ ok: true, skipped: 'not_pending' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: business, error: bErr } = await admin
    .from('business_profiles')
    .select('id, owner_user_id, name, timezone')
    .eq('id', record.business_id)
    .maybeSingle();

  if (bErr || !business) {
    console.error('business load failed', bErr);
    return jsonResponse({ error: 'business_not_found' }, 404);
  }

  const { data: tokens, error: tErr } = await admin
    .from('device_push_tokens')
    .select('id, expo_push_token')
    .eq('user_id', business.owner_user_id);

  if (tErr) {
    console.error('tokens load failed', tErr);
    return jsonResponse({ error: 'tokens_failed' }, 500);
  }

  if (!tokens?.length) {
    return jsonResponse({ ok: true, sent: 0, reason: 'no_tokens' });
  }

  const contact =
    record.client_email || record.client_phone || 'Client';
  const bodyText = `Ai o cerere pending de la ${contact}. Deschide Cereri pentru a răspunde.`;

  const messages = tokens.map((t) => ({
    to: t.expo_push_token,
    title: 'Cerere nouă de programare',
    body: bodyText,
    sound: 'default' as const,
    data: {
      screen: 'requests',
      appointmentId: record.id,
      businessId: record.business_id,
    },
  }));

  let expoRes: Response;
  try {
    expoRes = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.error('Expo push fetch failed', e);
    return jsonResponse({ error: 'expo_push_failed' }, 502);
  }

  const expoJson = await expoRes.json().catch(() => null);
  console.log('Expo push response', expoRes.status, JSON.stringify(expoJson));

  // Delete DeviceNotRegistered tokens
  const tickets = Array.isArray(expoJson?.data)
    ? expoJson.data
    : expoJson?.data
      ? [expoJson.data]
      : [];

  const toDelete: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (
      ticket?.status === 'error' &&
      (ticket?.details?.error === 'DeviceNotRegistered' ||
        ticket?.message?.includes?.('DeviceNotRegistered'))
    ) {
      toDelete.push(tokens[i].expo_push_token);
    }
  }

  if (toDelete.length) {
    await admin.from('device_push_tokens').delete().in('expo_push_token', toDelete);
    console.log('Removed invalid tokens', toDelete.length);
  }

  return jsonResponse({
    ok: true,
    sent: messages.length,
    expoStatus: expoRes.status,
    removedInvalid: toDelete.length,
  });
});
