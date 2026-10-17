/**
 * Edge Function: create-deposit-checkout
 *
 * Body: { appointment_id, success_url?, cancel_url? }
 * Auth: JWT of the appointment's client.
 *
 * Returns Stripe Checkout URL when STRIPE_SECRET_KEY is set.
 * If Stripe is not configured: { error: 'stripe_not_configured' } — business marks cash/transfer.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';

type Payload = {
  appointment_id?: string;
  success_url?: string;
  cancel_url?: string;
  tip_ron?: number;
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return jsonResponse({ error: 'stripe_not_configured' }, 400);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const appointmentId = payload.appointment_id;
  if (!appointmentId) {
    return jsonResponse({ error: 'invalid_payload' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: apt } = await admin
    .from('appointments')
    .select('id, business_id, client_user_id, payment_status, deposit_ron, status, start_at')
    .eq('id', appointmentId)
    .maybeSingle();

  if (!apt || apt.client_user_id !== user.id) {
    return jsonResponse({ error: 'forbidden' }, 403);
  }
  if (apt.payment_status !== 'unpaid' || Number(apt.deposit_ron) <= 0) {
    return jsonResponse({ error: 'not_payable' }, 400);
  }
  if (apt.status !== 'pending' && apt.status !== 'approved') {
    return jsonResponse({ error: 'not_payable' }, 400);
  }

  const { data: biz } = await admin
    .from('business_profiles')
    .select('name, public_code')
    .eq('id', apt.business_id)
    .maybeSingle();

  const amountBani = Math.round(Number(apt.deposit_ron) * 100);
  if (!Number.isFinite(amountBani) || amountBani < 200) {
    return jsonResponse({ error: 'amount_too_small' }, 400);
  }

  const tipRon = Number(payload.tip_ron ?? 0);
  if (!Number.isFinite(tipRon) || tipRon < 0 || tipRon > Number(apt.deposit_ron) * 10) {
    return jsonResponse({ error: 'invalid_tip' }, 400);
  }
  const tipBani = Math.round(tipRon * 100);

  const fallback =
    Deno.env.get('EXPO_PUBLIC_WEB_BASE_URL')?.replace(/\/$/, '') ||
    supabaseUrl;
  const successUrl = (payload.success_url ?? `${fallback}/my-appointments`).trim();
  const cancelUrl = (payload.cancel_url ?? successUrl).trim();

  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('client_reference_id', apt.id);
  body.set('metadata[appointment_id]', apt.id);
  body.set('metadata[business_id]', apt.business_id);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'ron');
  body.set('line_items[0][price_data][unit_amount]', String(amountBani));
  body.set(
    'line_items[0][price_data][product_data][name]',
    `Avans ${biz?.name ?? 'Programari'}`
  );

  if (tipBani > 0) {
    body.set('line_items[1][quantity]', '1');
    body.set('line_items[1][price_data][currency]', 'ron');
    body.set('line_items[1][price_data][unit_amount]', String(tipBani));
    body.set('line_items[1][price_data][product_data][name]', 'Bacsis');
    body.set('metadata[tip_ron]', String(tipRon));
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const session = await stripeRes.json();
  if (!stripeRes.ok || !session?.url) {
    console.error('stripe checkout failed', session);
    return jsonResponse({ error: 'stripe_checkout_failed' }, 502);
  }

  await admin.from('payments').insert({
    business_id: apt.business_id,
    appointment_id: apt.id,
    client_user_id: apt.client_user_id,
    amount_ron: Number(apt.deposit_ron) + tipRon,
    status: 'pending',
    provider: 'stripe',
    provider_ref: session.id,
  });

  if (tipBani > 0) {
    await admin.from('appointments').update({ tip_ron: tipRon }).eq('id', apt.id);
  }

  return jsonResponse({ ok: true, url: session.url, session_id: session.id });
});
