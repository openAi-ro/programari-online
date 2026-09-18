/**
 * Edge Function: stripe-webhook
 *
 * Stripe Checkout → marks appointment deposit as paid.
 * Configure in Stripe Dashboard: checkout.session.completed, charge.refunded
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { jsonResponse } from '../_shared/cors.ts';

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...rest] = p.split('=');
      return [k.trim(), rest.join('=')];
    })
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !stripeKey || !supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const rawBody = await req.text();
  const header = req.headers.get('stripe-signature') ?? '';
  const ok = await verifyStripeSignature(rawBody, header, secret);
  if (!ok) {
    return jsonResponse({ error: 'invalid_signature' }, 400);
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const obj = event.data?.object ?? {};

  if (event.type === 'checkout.session.completed') {
    const appointmentId =
      (obj.metadata as { appointment_id?: string } | undefined)?.appointment_id ||
      (obj.client_reference_id as string | undefined);
    const sessionId = obj.id as string | undefined;
    if (!appointmentId) {
      return jsonResponse({ ok: true, skipped: true });
    }

    await admin
      .from('appointments')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('payment_status', 'unpaid');

    if (sessionId) {
      await admin
        .from('payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          provider_ref: sessionId,
        })
        .eq('provider', 'stripe')
        .eq('provider_ref', sessionId);
    }

    return jsonResponse({ ok: true });
  }

  if (event.type === 'charge.refunded' || event.type === 'refund.updated') {
    const paymentIntent = (obj.payment_intent as string | undefined) ?? null;
    if (paymentIntent) {
      const { data: pay } = await admin
        .from('payments')
        .select('id, appointment_id')
        .eq('provider', 'stripe')
        .eq('provider_ref', paymentIntent)
        .maybeSingle();
      if (pay?.appointment_id) {
        await admin
          .from('appointments')
          .update({
            payment_status: 'refunded',
            updated_at: new Date().toISOString(),
          })
          .eq('id', pay.appointment_id)
          .eq('payment_status', 'paid');
        await admin
          .from('payments')
          .update({ status: 'refunded' })
          .eq('id', pay.id);
      }
    }
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ ok: true, ignored: event.type });
});
