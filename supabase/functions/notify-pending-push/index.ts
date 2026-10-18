/**
 * Edge Function: notify-pending-push
 *
 * Trigger: Database Webhook on INSERT into public.appointments
 * (or manual/app POST with { record } / { id, business_id, ... }).
 *
 * 1) Expo push to business owner device tokens
 * 2) WhatsApp/email to owner profile (even if no push tokens)
 *
 * Webhook setup (Dashboard → Database → Webhooks):
 *   Table: appointments
 *   Events: INSERT
 *   URL: https://<project-ref>.supabase.co/functions/v1/notify-pending-push
 *   Headers: Authorization: Bearer <SERVICE_ROLE_OR_ANON>, optional x-webhook-secret
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  messageNewPendingRequest,
  messageRescheduledRequest,
  notifyClientChannels,
} from '../_shared/notify.ts';
import { notifyLocale, parseNotifyLang } from '../_shared/notify.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type AppointmentRow = {
  id: string;
  business_id: string;
  status: string;
  client_email?: string | null;
  client_phone?: string | null;
  client_user_id?: string | null;
  start_at?: string;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  record?: AppointmentRow;
  id?: string;
  business_id?: string;
  status?: string;
  client_email?: string | null;
  client_phone?: string | null;
  start_at?: string;
  reason?: string | null;
  lang?: string;
};

function formatWhen(iso: string | undefined, timezone: string, lang: 'ro' | 'en'): string | undefined {
  if (!iso) return undefined;
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

/** webhook secret, service role, or any authenticated JWT (booking client invoke). */
async function authorizePendingPush(req: Request): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
  if (webhookSecret) {
    const header = req.headers.get('x-webhook-secret');
    if (header === webhookSecret) return { ok: true };
  }

  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (serviceKey && bearer === serviceKey) return { ok: true };
  if (anonKey && bearer === anonKey) return { ok: true };

  // Legacy/service JWT: role claim (getUser() does not accept service_role)
  if (bearer.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(bearer.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      if (payload?.role === 'service_role') return { ok: true };
    } catch {
      // ignore decode errors
    }
  }

  // No auth material at all
  if (!webhookSecret && !bearer) return { ok: true };

  if (!bearer) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: 'server_misconfigured' };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser(bearer);

  if (userErr || !user) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const authResult = await authorizePendingPush(req);
  if (!authResult.ok) {
    return jsonResponse({ error: authResult.error }, authResult.status);
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  let record: AppointmentRow | undefined =
    payload.record ??
    (payload.id && payload.business_id
      ? {
          id: payload.id,
          business_id: payload.business_id,
          status: payload.status ?? 'pending',
          client_email: payload.client_email,
          client_phone: payload.client_phone,
          start_at: payload.start_at,
        }
      : undefined);

  if (!record?.id || !record.business_id) {
    return jsonResponse({ error: 'missing_record' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Enrich from DB when client fields missing (e.g. SQL insert / id-only invoke)
  if (
    (!record.client_email && !record.client_phone) ||
    !record.start_at ||
    !record.status
  ) {
    const { data: live } = await admin
      .from('appointments')
      .select('id, business_id, status, client_email, client_phone, client_user_id, start_at')
      .eq('id', record.id)
      .maybeSingle();
    if (live) {
      record = { ...live, ...record, status: record.status || live.status };
    }
  }

  if (record.status && record.status !== 'pending' && record.status !== 'approved') {
    return jsonResponse({
      ok: true,
      skipped: 'not_pending',
      sent_push: 0,
      sent_whatsapp: false,
      reason: 'not_pending',
    });
  }

  const { data: business, error: bErr } = await admin
    .from('business_profiles')
    .select('id, owner_user_id, name, timezone')
    .eq('id', record.business_id)
    .maybeSingle();

  if (bErr || !business) {
    console.error('business load failed', bErr);
    return jsonResponse({ error: 'business_not_found' }, 404);
  }

  const contact =
    record.client_email || record.client_phone || 'Client';
  const { data: ownerProfile } = await admin
    .from('profiles')
    .select('email, phone, language')
    .eq('id', business.owner_user_id)
    .maybeSingle();
  const lang = parseNotifyLang((ownerProfile as { language?: string } | null)?.language ?? payload.lang);
  const rescheduled = payload.reason === 'rescheduled';
  const autoApproved = record.status === 'approved' && !rescheduled;
  const startLocal = formatWhen(record.start_at, business.timezone ?? 'Europe/Bucharest', lang);
  const pushTitle = rescheduled
    ? (lang === 'en' ? 'Booking moved' : 'Programare mutată')
    : autoApproved
      ? (lang === 'en' ? 'Auto-approved booking' : 'Programare auto-aprobată')
      : (lang === 'en' ? 'New booking request' : 'Cerere nouă de programare');
  const bodyText = rescheduled
    ? startLocal
      ? (lang === 'en' ? `${contact} moved the booking (${startLocal}). Open the Calendar.` : `${contact} a mutat programarea (${startLocal}). Deschide Calendarul.`)
      : (lang === 'en' ? `${contact} moved the booking. Open the Calendar.` : `${contact} a mutat programarea. Deschide Calendarul.`)
    : autoApproved
      ? startLocal
        ? (lang === 'en' ? `Auto-approved booking from ${contact} (${startLocal}).` : `Programare auto-aprobată de la ${contact} (${startLocal}).`)
        : (lang === 'en' ? `Auto-approved booking from ${contact}.` : `Programare auto-aprobată de la ${contact}.`)
      : startLocal
        ? (lang === 'en' ? `You have a pending request from ${contact} (${startLocal}). Open Requests to reply.` : `Ai o cerere pending de la ${contact} (${startLocal}). Deschide Cereri pentru a răspunde.`)
        : (lang === 'en' ? `You have a pending request from ${contact}. Open Requests to reply.` : `Ai o cerere pending de la ${contact}. Deschide Cereri pentru a răspunde.`);

  // --- Expo push ---
  let sentPush = 0;
  let pushReason: string | null = null;
  let removedInvalid = 0;
  let expoStatus: number | null = null;

  const { data: tokens, error: tErr } = await admin
    .from('device_push_tokens')
    .select('id, expo_push_token')
    .eq('user_id', business.owner_user_id);

  if (tErr) {
    console.error('tokens load failed', tErr);
    pushReason = 'tokens_failed';
  } else if (!tokens?.length) {
    pushReason = 'no_tokens';
  } else {
    // Doar câmpuri suportate de Expo Push API.
    // channelId trebuie să existe deja pe dispozitiv, altfel Android NU afișează nimic.
    const messages = tokens.map((t) => ({
      to: t.expo_push_token,
      title: pushTitle,
      body: bodyText,
      sound: 'default' as const,
      priority: 'high' as const,
      channelId: 'cereri_heads',
      data: {
        screen: 'requests',
        appointmentId: record!.id,
        businessId: record!.business_id,
      },
    }));

    try {
      const expoRes = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      expoStatus = expoRes.status;
      const expoJson = await expoRes.json().catch(() => null);
      console.log('Expo push response', expoRes.status, JSON.stringify(expoJson));

      const tickets = Array.isArray(expoJson?.data)
        ? expoJson.data
        : expoJson?.data
          ? [expoJson.data]
          : [];

      const toDelete: string[] = [];
      let ticketErrors = 0;
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket?.status === 'ok') {
          sentPush += 1;
          continue;
        }
        ticketErrors += 1;
        const errCode = ticket?.details?.error ?? ticket?.message ?? 'ticket_error';
        console.error('Expo ticket error', errCode);
        if (
          errCode === 'DeviceNotRegistered' ||
          String(ticket?.message ?? '').includes('DeviceNotRegistered')
        ) {
          toDelete.push(tokens[i].expo_push_token);
        } else if (
          String(errCode).includes('InvalidCredentials') ||
          String(errCode).includes('FCM') ||
          String(errCode).includes('MismatchSenderId')
        ) {
          pushReason = `expo_${String(errCode)}`;
        }
      }

      if (!tickets.length && expoRes.ok) {
        // Răspuns neașteptat — nu pretindem succes.
        pushReason = pushReason ?? 'expo_empty_tickets';
      } else if (ticketErrors && !sentPush) {
        pushReason = pushReason ?? 'expo_all_tickets_failed';
      }

      if (toDelete.length) {
        await admin.from('device_push_tokens').delete().in('expo_push_token', toDelete);
        removedInvalid = toDelete.length;
        console.log('Removed invalid tokens', toDelete.length);
      }
    } catch (e) {
      console.error('Expo push fetch failed', e);
      pushReason = 'expo_push_failed';
    }
  }

  // --- Owner WhatsApp / email (profile loaded above; even when no push tokens) ---

  const msg = rescheduled
    ? messageRescheduledRequest(business.name, contact, startLocal, lang)
    : messageNewPendingRequest(business.name, contact, startLocal, lang);
  let sentWhatsapp = false;
  let sentEmail = false;
  let ownerReason: string | null = null;

  if (!ownerProfile?.email && !ownerProfile?.phone) {
    ownerReason = 'owner_no_contact';
  } else {
    const channelResults = await notifyClientChannels({
      email: ownerProfile.email ?? null,
      phone: ownerProfile.phone ?? null,
      subject: msg.subject,
      text: msg.text,
      log: {
        admin,
        type: rescheduled ? 'OWNER_RESCHEDULED' : 'OWNER_PENDING',
        businessId: record!.business_id,
        appointmentId: record!.id,
      },
    });
    for (const r of channelResults) {
      if (r.channel === 'whatsapp' && r.ok) sentWhatsapp = true;
      if (r.channel === 'email' && r.ok) sentEmail = true;
    }
    if (!sentWhatsapp && !sentEmail) {
      ownerReason = 'owner_notify_failed';
    }
  }

  const reason =
    pushReason && ownerReason
      ? `${pushReason}+${ownerReason}`
      : pushReason ?? ownerReason ?? 'ok';

  return jsonResponse({
    ok: true,
    sent_push: sentPush,
    sent_whatsapp: sentWhatsapp,
    sent_email: sentEmail,
    reason,
    expoStatus,
    removedInvalid,
  });
});
