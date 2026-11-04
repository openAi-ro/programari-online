/**
 * Edge Function: test-whatsapp
 *
 * Sends a test WhatsApp message to the authenticated user's profile phone.
 * Always an approved Meta template (free text is dropped by Meta outside the 24h window,
 * error 131047): WHATSAPP_TPL_TEST, else WHATSAPP_TPL_CONFIRMED with sample vars.
 * Requires WHATSAPP_* or TWILIO_* secrets on Supabase (otherwise stub log).
 *
 * POST {} with user JWT
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  logNotification,
  messageTest,
  parseNotifyLang,
  sendWhatsApp,
  waTemplateName,
  type WaTemplateRef,
  whatsappUserHint,
} from '../_shared/notify.ts';
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

  const body = await req.json().catch(() => ({} as { lang?: string }));
  const { data: profile } = await userClient
    .from('profiles')
    .select('phone, email, notify_whatsapp, language')
    .eq('id', user.id)
    .maybeSingle();
  const lang = parseNotifyLang(
    (profile as { language?: string } | null)?.language ?? body.lang
  );

  if (profile?.notify_whatsapp === false) {
    return jsonResponse(
      {
        error: 'whatsapp_disabled',
        hint:
          lang === 'en'
            ? 'Enable the WhatsApp toggle in Settings to send messages to this number.'
            : 'Activează caseta WhatsApp în Setări ca să trimiți mesaje pe acest număr.',
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
        hint:
          lang === 'en'
            ? 'Add the phone number in Settings (07xx or +40... format).'
            : 'Adaugă numărul de telefon în Setări (format 07xx sau +40...).',
      },
      400
    );
  }

  const template: WaTemplateRef | null = waTemplateName('TEST')
    ? { key: 'TEST', vars: ['Programari'] }
    : waTemplateName('CONFIRMED')
      ? { key: 'CONFIRMED', vars: ['Programari', 'test'] }
      : null;
  if (!template) {
    return jsonResponse({
      ok: false,
      error: 'whatsapp_template_missing',
      hint:
        lang === 'en'
          ? 'No approved WhatsApp template is configured on the server (WHATSAPP_TPL_TEST / WHATSAPP_TPL_CONFIRMED).'
          : 'Nu e configurat niciun șablon WhatsApp aprobat pe server (WHATSAPP_TPL_TEST / WHATSAPP_TPL_CONFIRMED).',
    });
  }

  const copy = messageTest(lang);
  const result = await sendWhatsApp(phone, copy.text, { template });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceKey) {
    await logNotification(
      { admin: createClient(supabaseUrl, serviceKey), type: 'TEST' },
      phone,
      result
    );
  }

  // Safe subset for the app (no raw provider body).
  const safeResult = {
    ok: result.ok,
    stub: result.stub ?? false,
    outcome: result.outcome,
    provider: result.provider,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    template: result.template,
    messageId: result.messageId,
  };

  if (!result.ok && !result.stub) {
    // 200 so the app receives the body (supabase-js drops the body on non-2xx) and shows the real error.
    return jsonResponse({
      ok: false,
      error: 'whatsapp_send_failed',
      phone,
      result: safeResult,
      hint: `${whatsappUserHint(result, lang)}${result.errorCode ? ` (Meta ${result.errorCode})` : ''}`,
    });
  }

  return jsonResponse({
    ok: result.ok,
    phone,
    result: safeResult,
    hint: result.stub
      ? lang === 'en'
        ? 'WhatsApp is not configured on the server — the message was only logged (WHATSAPP_STUB). Set the Meta or Twilio secrets.'
        : 'WhatsApp nu e configurat pe server — mesajul a fost doar logat (WHATSAPP_STUB). Setează secrets Meta sau Twilio.'
      : lang === 'en'
        ? 'Sent to WhatsApp; Meta confirms delivery within seconds.'
        : 'Trimis spre WhatsApp; livrarea o confirmă Meta în câteva secunde.',
  });
});
