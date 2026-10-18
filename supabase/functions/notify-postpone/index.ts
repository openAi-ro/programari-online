/**
 * Edge Function: notify-postpone
 *
 * Body: { appointment_id, hours: 1 | 2 }
 * Auth: business owner JWT (authorizeNotifyRequest) OR service role / webhook secret.
 *
 * Shifts start_at and end_at by hours, resets reminder_sent, notifies client.
 *
 * URL: https://<ref>.supabase.co/functions/v1/notify-postpone
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizeNotifyRequest } from '../_shared/auth-notify.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  messagePostpone,
  notifyClientChannels,
  resolveClientPhone,
  notifyLocale,
  parseNotifyLang,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type Payload = {
  appointment_id?: string;
  id?: string;
  hours?: number;
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
  const hours = payload.hours;

  if (!appointmentId) {
    return jsonResponse({ error: 'missing_appointment_id' }, 400);
  }
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 1 || hours > 12) {
    return jsonResponse({ error: 'invalid_hours', detail: 'hours must be 1-12' }, 400);
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

  // Prefer approved; also allow pending for simple postpone before confirmation
  if (live.status !== 'approved' && live.status !== 'pending') {
    return jsonResponse(
      { error: 'status_not_postponeable', status: live.status },
      400
    );
  }

  const ms = hours * 60 * 60 * 1000;
  const newStart = new Date(new Date(live.start_at).getTime() + ms).toISOString();
  const newEnd = new Date(new Date(live.end_at).getTime() + ms).toISOString();

  const { data: updated, error: updErr } = await admin
    .from('appointments')
    .update({
      start_at: newStart,
      end_at: newEnd,
      reminder_sent: false,
      reminder_24h_sent: false,
      attendance_confirmed: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', live.id)
    .select('*')
    .maybeSingle();

  if (updErr || !updated) {
    console.error('postpone update failed', updErr);
    return jsonResponse({ error: 'update_failed', detail: updErr?.message }, 500);
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
  const newTimeLocal = formatTimeLocal(newStart, timezone, lang);
  const copy = messagePostpone(businessName, hours, newTimeLocal, timezone, lang);

  const results = await notifyClientChannels({
    email: live.client_email,
    phone: await resolveClientPhone(admin, live.client_phone, live.client_user_id),
    subject: copy.subject,
    text: copy.text,
    wa: copy.wa,
    log: { admin, type: 'POSTPONE', businessId: live.business_id, appointmentId: live.id },
  });
  // push popup client pentru amânare — sound+priority high via shared helper
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
    console.error('client postpone push failed', e);
  }

  return jsonResponse({
    ok: true,
    appointment_id: live.id,
    hours,
    start_at: newStart,
    end_at: newEnd,
    results,
    pushSent,
  });
});