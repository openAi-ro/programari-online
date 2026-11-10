/**
 * Edge Function: notify-reschedule (v87)
 *
 * Body: { appointment_id, event, lang? }
 * Auth: business/client JWT (authorizeNotifyRequest) OR service role / webhook secret.
 *
 * Events:
 * - accepted / declined / cancelled: salon -> client (v87)
 * - proposed: salon proposed a time -> client (v111)
 * - client_accepted / client_declined: client answered salon proposal -> salon push (v111)
 * Text is built from the DB row, never from the request body.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { authorizeNotifyRequest } from '../_shared/auth-notify.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  appWebBase,
  messageCancelledByBusiness,
  messageRescheduleAccepted,
  messageRescheduleDeclined,
  cancelNoticeAlreadySent,
  notifyClientChannels,
  notifyLocale,
  parseNotifyLang,
  resolveClientPhone,
  type WaTemplateRef,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type RescheduleEvent = 'accepted' | 'declined' | 'cancelled' | 'proposed' | 'client_accepted' | 'client_declined';
const EVENTS: RescheduleEvent[] = ['accepted', 'declined', 'cancelled', 'proposed', 'client_accepted', 'client_declined'];

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
  const proposedBy = (live as { reschedule_proposed_by?: string | null }).reschedule_proposed_by;
  const stateOk =
    event === 'cancelled'
      ? live.status === 'cancelled' && Boolean(live.cancel_reason)
      : event === 'proposed'
        ? active && live.requested_start_at != null && proposedBy === 'business'
        : event === 'client_accepted' || event === 'client_declined'
          ? active && live.requested_start_at == null
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
  const whenRequested = live.requested_start_at
    ? formatWhen(String(live.requested_start_at), timezone, lang)
    : when;
  const copy: { subject: string; text: string; wa?: WaTemplateRef } =
    event === 'accepted'
      ? messageRescheduleAccepted(businessName, when, lang)
      : event === 'declined'
        ? messageRescheduleDeclined(businessName, when, `${base}/my-appointments`, lang)
        : event === 'proposed'
          ? {
              subject: lang === 'en' ? `New time proposed by ${businessName}` : `Oră nouă propusă de ${businessName}`,
              text:
                lang === 'en'
                  ? `${businessName} proposed ${whenRequested}. Open the app to accept or decline. Until you answer, ${when} stays.`
                  : `${businessName} a propus ${whenRequested}. Deschide aplicația ca să accepți sau să refuzi. Până răspunzi, rămâne ${when}.`,
            }
          : event === 'client_accepted'
            ? {
                subject: lang === 'en' ? 'Client accepted the new time' : 'Clientul a acceptat noua oră',
                text:
                  lang === 'en'
                    ? `The client accepted the move to ${when}.`
                    : `Clientul a acceptat mutarea la ${when}.`,
              }
            : event === 'client_declined'
              ? {
                  subject: lang === 'en' ? 'Client declined the new time' : 'Clientul a refuzat noua oră',
                  text:
                    lang === 'en'
                      ? `The client declined your proposal. The booking stays at ${when}.`
                      : `Clientul a refuzat propunerea. Programarea rămâne la ${when}.`,
                }
              : messageCancelledByBusiness(
                  businessName,
                  when,
                  String(live.cancel_reason),
                  business?.public_code ? `${base}/b/${business.public_code}` : base,
                  lang
                );

  const toBusiness = event === 'client_accepted' || event === 'client_declined';
  if (!toBusiness && !wantsDecision) return jsonResponse({ ok: true, skipped: 'opted_out' });
  // F-C: anularea de către salon pleacă indiferent de „Anunță clientul”, dar o singură dată.
  if (event === 'cancelled') {
    const { data: sentBefore } = await admin
      .from('notification_log')
      .select('status')
      .eq('appointment_id', live.id)
      .eq('type', 'RESCHEDULE_CANCELLED')
      .eq('channel', 'email')
      .limit(5);
    if (cancelNoticeAlreadySent((sentBefore ?? []) as { status: string | null }[])) {
      return jsonResponse({ ok: true, skipped: 'already_sent' });
    }
  }

  let results: unknown = { skipped: true };
  let pushSent = 0;

  if (toBusiness) {
    const { data: bizOwner } = await admin
      .from('business_profiles')
      .select('owner_user_id')
      .eq('id', live.business_id)
      .maybeSingle();
    const ownerId = (bizOwner as { owner_user_id?: string } | null)?.owner_user_id;
    if (ownerId) {
      try {
        // deno-lint-ignore no-explicit-any
        const pushAdmin: any = admin;
        const { sent } = await sendExpoPushToUser(pushAdmin, ownerId, {
          title: copy.subject,
          body: copy.text,
          channelId: 'cereri_heads',
          data: { screen: 'business-requests', appointmentId: live.id, filter: 'all' },
        });
        pushSent = sent;
        results = { pushSent };
      } catch (e) {
        console.error('business proposal decision push failed', e);
      }
    }
  } else {
    results = await notifyClientChannels({
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

    if (live.client_user_id) {
      try {
        // deno-lint-ignore no-explicit-any
        const pushAdmin: any = admin;
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
  }

  return jsonResponse({ ok: true, event, results, pushSent });
});
