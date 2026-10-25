/**
 * Edge Function: auth-whatsapp-otp
 *
 * Public POST { phone } — send Meta/Twilio WhatsApp OTP (custom table, not Supabase phone OTP).
 * No JWT required (verify_jwt = false). Rate-limited atomically in auth_whatsapp_otp_reserve (v78):
 * 60s cooldown, max 5 codes per phone per 24h, max per client IP (hashed) per hour and per 24h.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { messageAuthOtp, parseNotifyLang, sendWhatsApp, whatsappUserHint, logNotification } from '../_shared/notify.ts';
import { normalizePhoneE164 } from '../_shared/phone.ts';
import { clientIpFrom } from '../_shared/aiCore.ts';
import { OTP_LIMITS, otpLimitHint, parseReserveVerdict } from './limits.ts';

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

  const ip = clientIpFrom((n) => req.headers.get(n));
  const code = generateCode();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + TTL_MS).toISOString();

  // Limits are checked and the code row reserved in one locked transaction (no parallel bypass).
  const { data: reserveData, error: reserveErr } = await admin.rpc('auth_whatsapp_otp_reserve', {
    p_phone: phone,
    p_ip_hash: ip ? await sha256Hex(`auth-otp:${ip}`) : null,
    p_code_hash: codeHash,
    p_expires_at: expiresAt,
    p_cooldown_seconds: OTP_LIMITS.cooldownSeconds,
    p_phone_per_day: OTP_LIMITS.phonePerDay,
    p_ip_per_hour: OTP_LIMITS.ipPerHour,
    p_ip_per_day: OTP_LIMITS.ipPerDay,
  });
  const verdict = reserveErr ? null : parseReserveVerdict(reserveData);
  if (!verdict) {
    console.error('auth-whatsapp-otp reserve', reserveErr?.message ?? reserveData);
    return jsonResponse({ error: 'otp_store_failed' }, 500);
  }
  if (!verdict.ok) {
    return jsonResponse(
      {
        error: 'rate_limited',
        reason: verdict.error,
        retry_after_s: verdict.retryAfterS,
        hint: otpLimitHint(verdict.error, verdict.retryAfterS, lang),
      },
      429
    );
  }
  const insertedId = verdict.id;

  const copy = messageAuthOtp(code, lang);
  const wa = await sendWhatsApp(phone, copy.text, { otpCode: code });
  await logNotification({ admin, type: 'OTP' }, phone, wa);

  if (!wa.ok && !wa.stub) {
    console.error('auth-whatsapp-otp send failed', wa);
    await admin.from('auth_whatsapp_otps').delete().eq('id', insertedId);
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
    .neq('id', insertedId);


  // Always ok for valid phone (do not leak whether a user account exists).
  if (wa.stub) {
    return jsonResponse({ ok: true, stub: true });
  }
  return jsonResponse({ ok: true });
});
