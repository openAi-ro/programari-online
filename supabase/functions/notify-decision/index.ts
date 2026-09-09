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
} from '../_shared/notify.ts';

type AppointmentRow = {
  id: string;
  business_id: string;
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
};

function formatWhen(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ro-RO', {
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

  const authResult = await authorizeNotifyRequest(req, admin, appointmentId);
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

  const { data: business } = await admin
    .from('business_profiles')
    .select('name, timezone')
    .eq('id', live.business_id)
    .maybeSingle();

  const businessName = business?.name ?? 'business';
  const timezone = business?.timezone ?? 'Europe/Bucharest';
  const whenLabel = formatWhen(live.start_at, timezone);

  const copy =
    live.status === 'approved'
      ? messageApproved(businessName, whenLabel)
      : messageRejected(businessName, whenLabel);

  const results = await notifyClientChannels({
    email: live.client_email,
    phone: live.client_phone,
    subject: copy.subject,
    text: copy.text,
  });

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

  return jsonResponse({ ok: true, status: live.status, results });
});
