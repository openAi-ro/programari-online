/**
 * Edge Function: notify-decision
 *
 * On appointment status → approved | rejected (decision_notified = false):
 * notify client via email/WhatsApp, then set decision_notified = true.
 *
 * Triggers:
 * - Database webhook UPDATE on appointments
 * - App invoke after approve/reject (JWT business owner)
 * - Manual POST with service role
 *
 * URL: https://<ref>.supabase.co/functions/v1/notify-decision
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizeNotifyRequest } from '../_shared/auth-notify.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  messageApproved,
  messageRejected,
  notifyClientChannels,
  resolveClientPhone,
  notifyLocale,
  parseNotifyLang,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type AppointmentRow = {
  id: string;
  business_id: string;
  client_user_id: string | null;
  status: string;
  client_email: string | null;
  client_phone: string | null;
  start_at: string;
  end_at: string;
  decision_notified: boolean;
};

type Payload = {
  type?: string;
  record?: AppointmentRow;
  old_record?: AppointmentRow | null;
  id?: string;
  appointment_id?: string;
  lang?: string;
};

function formatWhen(iso: string, timezone: string, lang: 'ro' | 'en'): string {
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const appointmentId =
    payload.record?.id ?? payload.id ?? payload.appointment_id;

  // Owner sau admin (programare rapidă cu „Anunță clientul"); staff → 403.
  const authResult = await authorizeNotifyRequest(req, admin, appointmentId, { allowAdmin: true });
  if (!authResult.ok) {
    return jsonResponse({ error: authResult.error }, authResult.status);
  }

  let record = payload.record;
  if (!record?.id && appointmentId) {
    const { data } = await admin
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .maybeSingle();
    record = data as AppointmentRow | undefined;
  }

  if (!record?.id) {
    return jsonResponse({ error: 'missing_record' }, 400);
  }

  if (record.status !== 'approved' && record.status !== 'rejected') {
    return jsonResponse({ ok: true, skipped: 'status_not_decision' });
  }

  if (record.decision_notified) {
    return jsonResponse({ ok: true, skipped: 'already_notified' });
  }

  const { data: live, error: liveErr } = await admin
    .from('appointments')
    .select('*')
    .eq('id', record.id)
    .maybeSingle();

  if (liveErr || !live) {
    return jsonResponse({ error: 'appointment_not_found' }, 404);
  }

  if (live.decision_notified) {
    return jsonResponse({ ok: true, skipped: 'already_notified' });
  }

  if (live.status !== 'approved' && live.status !== 'rejected') {
    return jsonResponse({ ok: true, skipped: 'status_not_decision' });
  }

  // v101: creată de business cu toggle OPRIT → clientul nu primește nimic.
  if (live.created_by && live.notify_client !== true) {
    return jsonResponse({ ok: true, skipped: 'business_no_notify' });
  }

  const { data: business } = await admin
    .from('business_profiles')
    .select('name, timezone')
    .eq('id', live.business_id)
    .maybeSingle();

  const businessName = business?.name ?? 'business';
  const timezone = business?.timezone ?? 'Europe/Bucharest';

  let wantsDecision = true;
  let wantsWhatsapp = true;
  let clientLang: string | undefined;
  if (live.client_user_id) {
    const { data: profile } = await admin
      .from('profiles')
      .select('notify_decision, notify_whatsapp, language')
      .eq('id', live.client_user_id)
      .maybeSingle();
    wantsDecision = profile?.notify_decision !== false;
    wantsWhatsapp = profile?.notify_whatsapp !== false;
    clientLang = (profile as { language?: string } | null)?.language;
  }

  const lang = parseNotifyLang(clientLang ?? payload.lang);
  const whenLabel = formatWhen(live.start_at, timezone, lang);

  const copy =
    live.status === 'approved'
      ? messageApproved(businessName, whenLabel, lang)
      : messageRejected(businessName, whenLabel, lang);

  const results = wantsDecision
    ? await notifyClientChannels({
        email: live.client_email,
        phone: wantsWhatsapp
          ? await resolveClientPhone(admin, live.client_phone, live.client_user_id)
          : null,
        subject: copy.subject,
        text: copy.text,
        wa: copy.wa,
        log: {
          admin,
          type: live.status === 'approved' ? 'CONFIRMED' : 'REJECTED',
          businessId: live.business_id,
          appointmentId: live.id,
        },
      })
    : [{ ok: false, channel: 'email' as const, error: 'opted_out' }];

  // popup push catre client (aprobat/respins) — sound+priority high via shared helper
  let pushSent = 0;
  if (live.client_user_id && wantsDecision) {
    try {
      const { sent } = await sendExpoPushToUser(admin, live.client_user_id, {
        title: copy.subject,
        body: copy.text,
        channelId: 'cereri_heads',
        data: { screen: 'my-appointments', appointmentId: live.id },
      });
      pushSent = sent;
    } catch (e) {
      console.error('client decision push failed', e);
    }
  }

  const { error: updErr } = await admin
    .from('appointments')
    .update({
      decision_notified: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', live.id)
    .eq('decision_notified', false);

  if (updErr) {
    console.error('decision_notified update failed', updErr);
    return jsonResponse({ error: 'update_failed', results }, 500);
  }

  return jsonResponse({ ok: true, status: live.status, results, pushSent });
});
