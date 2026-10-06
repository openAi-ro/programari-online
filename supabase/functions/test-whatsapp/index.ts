/**
 * Edge Function: test-whatsapp
 *
 * Sends a test WhatsApp message to the authenticated user's profile phone.
 * Requires WHATSAPP_* or TWILIO_* secrets on Supabase (otherwise stub log).
 *
 * POST {} with user JWT
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { messageTest, sendWhatsApp, whatsappUserHint } from '../_shared/notify.ts';
import { normalizePhoneE164 } from '../_shared/phone.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
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

  const { data: profile } = await userClient
    .from('profiles')
    .select('phone, email, notify_whatsapp')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.notify_whatsapp === false) {
    return jsonResponse(
      {
        error: 'whatsapp_disabled',
        hint: 'Activează caseta WhatsApp în Setări ca să trimiți mesaje pe acest număr.',
      },
      400
    );
  }

  const phone =
    normalizePhoneE164(profile?.phone) ?? normalizePhoneE164(user.phone);

  if (!phone) {
    return jsonResponse(
      {
        error: 'phone_required',
        hint: 'Adaugă numărul de telefon în Setări (format 07xx sau +40...).',
      },
      400
    );
  }

  const copy = messageTest();
  const result = await sendWhatsApp(phone, copy.text);

  if (!result.ok && !result.stub) {
    return jsonResponse(
      {
        ok: false,
        error: 'whatsapp_send_failed',
        phone,
        result,
        hint: whatsappUserHint(result),
      },
      502
    );
  }

  return jsonResponse({
    ok: result.ok,
    phone,
    result,
    hint: result.stub
      ? 'WhatsApp nu e configurat pe server — mesajul a fost doar logat (WHATSAPP_STUB). Setează secrets Meta sau Twilio.'
      : undefined,
  });
});
