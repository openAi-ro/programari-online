/**
 * Edge Function: refund-deposit
 *
 * Body: { appointment_id }
 * Auth: JWT of business owner (or client who cancelled).
 * Refunds Stripe payment if present; otherwise marks local status refunded.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

type Payload = { appointment_id?: string };

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const appointmentId = payload.appointment_id;
  if (!appointmentId) return jsonResponse({ error: 'invalid_payload' }, 400);

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
  const { data: apt } = await admin
    .from('appointments')
    .select('id, business_id, client_user_id, payment_status, deposit_ron, status')
    .eq('id', appointmentId)
    .maybeSingle();
  if (!apt) return jsonResponse({ error: 'not_found' }, 404);

  const { data: biz } = await admin
    .from('business_profiles')
    .select('owner_user_id')
    .eq('id', apt.business_id)
    .maybeSingle();

  const allowed = user.id === apt.client_user_id || user.id === biz?.owner_user_id;
  if (!allowed) return jsonResponse({ error: 'forbidden' }, 403);
  if (apt.payment_status !== 'paid') {
    return jsonResponse({ ok: true, skipped: true });
  }

  const { data: pay } = await admin
    .from('payments')
    .select('id, provider, provider_ref, amount_ron')
    .eq('appointment_id', apt.id)
    .eq('status', 'paid')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (pay?.provider === 'stripe' && pay.provider_ref && stripeKey) {
    let sessionId = pay.provider_ref;
    if (sessionId.startsWith('cs_')) {
      const sessRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${stripeKey}` },
      });
      const sess = await sessRes.json();
      const pi = sess?.payment_intent as string | undefined;
      if (pi) {
        const refundRes = await fetch('https://api.stripe.com/v1/refunds', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ payment_intent: pi }),
        });
        if (!refundRes.ok) {
          const err = await refundRes.json();
          console.error('stripe refund failed', err);
          return jsonResponse({ error: 'stripe_refund_failed' }, 502);
        }
      }
    }
  }

  await admin
    .from('appointments')
    .update({
      payment_status: 'refunded',
      updated_at: new Date().toISOString(),
    })
    .eq('id', apt.id)
    .eq('payment_status', 'paid');

  if (pay?.id) {
    await admin.from('payments').update({ status: 'refunded' }).eq('id', pay.id);
  }

  return jsonResponse({ ok: true });
});
