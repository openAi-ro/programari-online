/**
 * Edge Function: notify-reschedule (v87)
 *
 * Body: { appointment_id, event: 'accepted' | 'declined' | 'cancelled', lang? }
 * Auth: business owner JWT (authorizeNotifyRequest) OR service role / webhook secret.
 *
 * Tells the client what the salon decided, after the matching RPC already ran:
 * - accepted  (business_accept_reschedule): new time; WhatsApp uses the approved MOVED template.
 * - declined  (business_decline_reschedule): the original time stays + link to propose another.
 * - cancelled (business_cancel_appointment): the salon's reason + booking link.
 * The text is built from the DB row, never from the request body, and the event must match
 * the row's state (no request pending; cancelled with a reason).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizeNotifyRequest } from '../_shared/auth-notify.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  appWebBase,
  messageCancelledByBusiness,
  messageRescheduleAccepted,
  messageRescheduleDeclined,
  notifyClientChannels,
  notifyLocale,
  parseNotifyLang,
  resolveClientPhone,
  type WaTemplateRef,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type RescheduleEvent = 'accepted' | 'declined' | 'cancelled';
const EVENTS: RescheduleEvent[] = ['accepted', 'declined', 'cancelled'];

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
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let payload: { appointment_id?: string; event?: string; lang?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const appointmentId = payload.appointment_id;
  const event = EVENTS.find((e) => e === payload.event);
  if (!appointmentId || !event) return jsonResponse({ error: 'missing_appointment_or_event' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: 'server_misconfigured' }, 500);
  const admin = createClient(supabaseUrl, serviceKey);

  const authResult = await authorizeNotifyRequest(req, admin, appointmentId);
  if (!authResult.ok) return jsonResponse({ error: authResult.error }, authResult.status);

  const { data: live } = await admin.from('appointments').select('*').eq('id', appointmentId).maybeSingle();
  if (!live) return jsonResponse({ error: 'appointment_not_found' }, 404);

  const active = live.status === 'pending' || live.status === 'approved';
  const stateOk =
    event === 'cancelled'
      ? live.status === 'cancelled' && Boolean(live.cancel_reason)
      : active && live.requested_start_at == null;
  if (!stateOk) return jsonResponse({ error: 'state_mismatch', status: live.status }, 409);

  const { data: business } = await admin
    .from('business_profiles')
    .select('name, timezone, public_code')
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
  const when = formatWhen(live.start_at, timezone, lang);
  const base = appWebBase();
  const copy: { subject: string; text: string; wa?: WaTemplateRef } =
    event === 'accepted'
      ? messageRescheduleAccepted(businessName, when, lang)
      : event === 'declined'
        ? messageRescheduleDeclined(businessName, when, `${base}/my-appointments`, lang)
        : messageCancelledByBusiness(
            businessName,
            when,
            String(live.cancel_reason),
            business?.public_code ? `${base}/b/${business.public_code}` : base,
            lang
          );

  if (!wantsDecision) return jsonResponse({ ok: true, skipped: 'opted_out' });

  const results = await notifyClientChannels({
    email: live.client_email,
    phone: wantsWhatsapp ? await resolveClientPhone(admin, live.client_phone, live.client_user_id) : null,
    subject: copy.subject,
    text: copy.text,
    wa: copy.wa,
    log: {
      admin,
      type: `RESCHEDULE_${event.toUpperCase()}`,
      businessId: live.business_id,
      appointmentId: live.id,
    },
  });

  let pushSent = 0;
  if (live.client_user_id) {
    try {
      // deno-lint-ignore no-explicit-any
      const pushAdmin: any = admin; // supabase-js generics hit TS2589 here (same as notify-moved)
      const { sent } = await sendExpoPushToUser(pushAdmin, live.client_user_id, {
        title: copy.subject,
        body: copy.text,
        channelId: 'cereri_heads',
        data: { screen: 'my-appointments', appointmentId: live.id },
      });
      pushSent = sent;
    } catch (e) {
      console.error('client reschedule push failed', e);
    }
  }

  return jsonResponse({ ok: true, event, results, pushSent });
});
