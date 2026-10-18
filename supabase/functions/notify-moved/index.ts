/**
 * Edge Function: notify-moved
 *
 * Body: { appointment_id }
 * Auth: business owner JWT (authorizeNotifyRequest) OR service role / webhook secret.
 *
 * Citeste ora curenta a programarii (mutata deja prin business_move_appointment)
 * si notifica clientul pe email/WhatsApp + push.
 *
 * URL: https://<ref>.supabase.co/functions/v1/notify-moved
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizeNotifyRequest } from '../_shared/auth-notify.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  messageMoved,
  notifyClientChannels,
  resolveClientPhone,
  notifyLocale,
  parseNotifyLang,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type Payload = {
  appointment_id?: string;
  id?: string;
  lang?: string;
};

function formatTimeLocal(iso: string, timezone: string, lang: 'ro' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(notifyLocale(lang), {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

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

  const appointmentId = payload.appointment_id ?? payload.id;
  if (!appointmentId) {
    return jsonResponse({ error: 'missing_appointment_id' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const authResult = await authorizeNotifyRequest(req, admin, appointmentId);
  if (!authResult.ok) {
    return jsonResponse({ error: authResult.error }, authResult.status);
  }

  const { data: live, error: liveErr } = await admin
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .maybeSingle();

  if (liveErr || !live) {
    return jsonResponse({ error: 'appointment_not_found' }, 404);
  }

  if (live.status !== 'approved' && live.status !== 'pending') {
    return jsonResponse(
      { error: 'status_not_movable', status: live.status },
      400
    );
  }

  const { data: business } = await admin
    .from('business_profiles')
    .select('name, timezone')
    .eq('id', live.business_id)
    .maybeSingle();

  const businessName = business?.name ?? 'business';
  const timezone = business?.timezone ?? 'Europe/Bucharest';
  let clientLang: string | undefined;
  if ((live as { client_user_id?: string | null }).client_user_id) {
    const { data: clientProfile } = await admin
      .from('profiles')
      .select('language')
      .eq('id', (live as { client_user_id: string }).client_user_id)
      .maybeSingle();
    clientLang = (clientProfile as { language?: string } | null)?.language;
  }
  const lang = parseNotifyLang(clientLang ?? payload.lang);
  const newTimeLocal = formatTimeLocal(live.start_at, timezone, lang);
  const copy = messageMoved(businessName, newTimeLocal, timezone, lang);

  const results = await notifyClientChannels({
    email: live.client_email,
    phone: await resolveClientPhone(admin, live.client_phone, live.client_user_id),
    subject: copy.subject,
    text: copy.text,
    wa: copy.wa,
    log: { admin, type: 'MOVED', businessId: live.business_id, appointmentId: live.id },
  });

  let pushSent = 0;
  try {
    if (live.client_user_id) {
      const { sent } = await sendExpoPushToUser(admin, live.client_user_id, {
        title: copy.subject,
        body: copy.text,
        channelId: 'cereri_heads',
        data: { screen: 'my-appointments', appointmentId: live.id },
      });
      pushSent = sent;
    }
  } catch (e) {
    console.error('client moved push failed', e);
  }

  return jsonResponse({
    ok: true,
    appointment_id: live.id,
    start_at: live.start_at,
    end_at: live.end_at,
    results,
    pushSent,
  });
});
