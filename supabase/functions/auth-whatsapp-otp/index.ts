/**
 * Edge Function: auth-whatsapp-otp
 *
 * Public POST { phone } — send Meta/Twilio WhatsApp OTP (custom table, not Supabase phone OTP).
 * No JWT required (verify_jwt = false). Rate-limited: 60s cooldown per phone.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { messageAuthOtp, parseNotifyLang, sendWhatsApp, whatsappUserHint } from '../_shared/notify.ts';
import { normalizePhoneE164 } from '../_shared/phone.ts';

const COOLDOWN_MS = 60_000;
const TTL_MS = 15 * 60_000;

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  let body: { phone?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const phone = normalizePhoneE164(body.phone);
  const lang = parseNotifyLang(body.lang);
  if (!phone) {
    return jsonResponse(
      {
        error: 'invalid_phone',
        hint: lang === 'en' ? 'Use a valid number (07xxxxxxxx or +40...).' : 'Folosește un număr valid (07xxxxxxxx sau +40...).',
      },
      400
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cooldownSince = new Date(Date.now() - COOLDOWN_MS).toISOString();
  const { data: recent } = await admin
    .from('auth_whatsapp_otps')
    .select('id')
    .eq('phone', phone)
    .gte('created_at', cooldownSince)
    .limit(1)
    .maybeSingle();

  if (recent) {
    return jsonResponse(
      {
        error: 'rate_limited',
        hint: lang === 'en' ? 'Wait 60 seconds before requesting a new code.' : 'Așteaptă 60 de secunde înainte de a cere un cod nou.',
      },
      429
    );
  }

  const now = new Date();
  const code = generateCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(now.getTime() + TTL_MS).toISOString();

  const { data: inserted, error: insertErr } = await admin
    .from('auth_whatsapp_otps')
    .insert({
      phone,
      code_hash: codeHash,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insertErr || !inserted?.id) {
    console.error('auth-whatsapp-otp insert', insertErr);
    return jsonResponse({ error: 'otp_store_failed' }, 500);
  }

  const copy = messageAuthOtp(code, lang);
  const wa = await sendWhatsApp(phone, copy.text, { otpCode: code });

  if (!wa.ok && !wa.stub) {
    console.error('auth-whatsapp-otp send failed', wa);
    await admin.from('auth_whatsapp_otps').delete().eq('id', inserted.id);
    return jsonResponse(
      {
        error: 'whatsapp_send_failed',
        hint: whatsappUserHint(wa, lang),
      },
      502
    );
  }

  // Invalidate previous codes only after this one is stored and sent.
  await admin
    .from('auth_whatsapp_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('phone', phone)
    .is('consumed_at', null)
    .neq('id', inserted.id);


  // Always ok for valid phone (do not leak whether a user account exists).
  if (wa.stub) {
    return jsonResponse({ ok: true, stub: true });
  }
  return jsonResponse({ ok: true });
});