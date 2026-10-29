/**
 * Edge Function: notify-pending-push
 *
 * Trigger: Database Webhook on INSERT into public.appointments
 * (or manual/app POST with { record } / { id, business_id, ... }).
 *
 * 1) Expo push to business owner device tokens
 * 2) WhatsApp/email to owner profile (even if no push tokens);
 *    auto-approved bookings: email only (no approved WhatsApp template for them)
 * 3) New booking assigned to a staff member: push to the staff member's account
 *    (business_members.staff_id) + email (profile email, else staff_private.email).
 *    Skipped when that account is the owner. notification_log type STAFF_NEW_BOOKING.
 *
 * Webhook setup (Dashboard → Database → Webhooks):
 *   Table: appointments
 *   Events: INSERT
 *   URL: https://<project-ref>.supabase.co/functions/v1/notify-pending-push
 *   Implemented as SQL trigger public.appointment_insert_push_webhook() (pg_net),
 *   header x-webhook-secret read from Vault secret `webhook_secret` (= WEBHOOK_SECRET).
 */
import { isBusinessCreatedInsert } from '../_shared/businessCreated.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { bearerToken, checkWebhookSecret, isServiceRole } from '../_shared/secret-auth.ts';
import {
  appWebBase,
  logNotification,
  messageAutoApprovedOwner,
  messageNewPendingRequest,
  messageStaffNewBooking,
  sendEmail,
  messageRescheduledRequest,
  messageRescheduleRequested,
  notifyClientChannels,
  type WaTemplateRef,
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
  requested_start_at?: string | null;
  created_by?: string | null;
  staff_id?: string | null;
  service_name?: string | null;
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

/**
 * Who may call this function:
 * - DB webhook (trigger `appointment-insert-push`): x-webhook-secret header from Vault;
 * - server code: service-role bearer;
 * - the app (reschedule flow, lib/notify-client.ts invokePendingPush): a signed-in user
 *   who is the client of that appointment or the owner of its business. For users the
 *   record is always re-read from the DB, client-supplied fields are ignored.
 * Fail-closed: WEBHOOK_SECRET missing -> 500.
 */
type PendingAuth =
  | { ok: true; userId: string | null }
  | { ok: false; status: number; error: string };

async function authorizePendingPush(req: Request): Promise<PendingAuth> {
  const webhook = checkWebhookSecret(req);
  if (webhook === 'missing') return { ok: false, status: 500, error: 'server_misconfigured' };
  if (webhook === 'ok' || isServiceRole(req)) return { ok: true, userId: null };

  const bearer = bearerToken(req);
  if (!bearer) return { ok: false, status: 401, error: 'unauthorized' };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: 'server_misconfigured' };
  }

  const userClient = createClient(supabaseUrl, anonKey);
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser(bearer);

  if (userErr || !user) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  return { ok: true, userId: user.id };
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

  // v101: business-ul și-a creat singur programarea (rapidă din calendar) → fără push/WhatsApp/email către el.
  if (isBusinessCreatedInsert(payload.type, record, payload.reason)) {
    return jsonResponse({ ok: true, skipped: 'business_created', sent_push: 0, sent_whatsapp: false });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Signed-in app user: only for an appointment they booked or whose business they own;
  // use the DB row, not the request body.
  if (authResult.userId) {
    const { data: live } = await admin
      .from('appointments')
      .select('id, business_id, status, client_email, client_phone, client_user_id, start_at, requested_start_at, staff_id, service_name')
      .eq('id', record.id)
      .maybeSingle();
    if (!live) return jsonResponse({ error: 'appointment_not_found' }, 404);
    let allowed = live.client_user_id === authResult.userId;
    if (!allowed) {
      const { data: owner } = await admin
        .from('business_profiles')
        .select('owner_user_id')
        .eq('id', live.business_id)
        .maybeSingle();
      allowed = owner?.owner_user_id === authResult.userId;
    }
    if (!allowed) return jsonResponse({ error: 'forbidden' }, 403);
    record = live;
  }

  // Enrich from DB when client fields missing (e.g. SQL insert / id-only invoke)
  if (
    (!record.client_email && !record.client_phone) ||
    !record.start_at ||
    !record.status
  ) {
    const { data: live } = await admin
      .from('appointments')
      .select('id, business_id, status, client_email, client_phone, client_user_id, start_at, requested_start_at, staff_id, service_name')
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
  // 'reschedule_requested' (v87): the client proposed a new time; requested_start_at is read from the DB.
  const requestedLocal =
    payload.reason === 'reschedule_requested' && record.requested_start_at
      ? formatWhen(record.requested_start_at, business.timezone ?? 'Europe/Bucharest', lang)
      : undefined;
  const rescheduleRequested = Boolean(requestedLocal);
  const rescheduled = payload.reason === 'rescheduled' || rescheduleRequested;
  const autoApproved = record.status === 'approved' && !rescheduled;
  const startLocal = formatWhen(record.start_at, business.timezone ?? 'Europe/Bucharest', lang);
  const requestCopy = rescheduleRequested
    ? messageRescheduleRequested(business.name, contact, startLocal ?? '-', requestedLocal!, lang)
    : null;
  const pushTitle = requestCopy
    ? requestCopy.subject
    : rescheduled
    ? (lang === 'en' ? 'Booking moved' : 'Programare mutată')
    : autoApproved
      ? (lang === 'en' ? 'New confirmed booking' : 'Programare nouă confirmată')
      : (lang === 'en' ? 'New booking request' : 'Cerere nouă de programare');
  const bodyText = requestCopy
    ? requestCopy.text
    : rescheduled
    ? startLocal
      ? (lang === 'en' ? `${contact} moved the booking (${startLocal}). Open the Calendar.` : `${contact} a mutat programarea (${startLocal}). Deschide Calendarul.`)
      : (lang === 'en' ? `${contact} moved the booking. Open the Calendar.` : `${contact} a mutat programarea. Deschide Calendarul.`)
    : autoApproved
      ? startLocal
        ? (lang === 'en' ? `${contact} (${startLocal}), approved automatically.` : `${contact} (${startLocal}), aprobată automat.`)
        : (lang === 'en' ? `${contact}, approved automatically.` : `${contact}, aprobată automat.`)
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
        ...(rescheduleRequested ? { filter: 'decide' } : {}),
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

  const msg: { subject: string; text: string; wa?: WaTemplateRef } = requestCopy
    ? requestCopy
    : rescheduled
    ? messageRescheduledRequest(business.name, contact, startLocal, lang)
    : autoApproved
    ? messageAutoApprovedOwner(business.name, contact, startLocal, lang)
    : messageNewPendingRequest(business.name, contact, startLocal, lang);
  let sentWhatsapp = false;
  let sentEmail = false;
  let ownerReason: string | null = null;

  if (!ownerProfile?.email && !ownerProfile?.phone) {
    ownerReason = 'owner_no_contact';
  } else {
    const channelResults = await notifyClientChannels({
      email: ownerProfile.email ?? null,
      // Auto-approved: no approved WhatsApp template fits, and free text outside the 24h
      // window always fails (Meta 131047) -> owner gets push + email only.
      phone: autoApproved ? null : ownerProfile.phone ?? null,
      subject: msg.subject,
      text: msg.text,
      wa: msg.wa,
      log: {
        admin,
        type: rescheduleRequested ? 'OWNER_RESCHEDULE_REQUEST' : rescheduled ? 'OWNER_RESCHEDULED' : 'OWNER_PENDING',
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

  // --- Assigned staff member (new bookings only; not for moves) ---
  const staff = rescheduled
    ? { sent_push: 0, sent_email: false, reason: 'skipped_rescheduled' }
    : await notifyAssignedStaff(admin, {
        record: record!,
        businessName: business.name,
        timezone: business.timezone ?? 'Europe/Bucharest',
        ownerUserId: business.owner_user_id,
        ownerEmail: ownerProfile?.email ?? null,
        contact,
        pending: !autoApproved,
        fallbackLang: lang,
      });

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
    staff,
  });
});

// deno-lint-ignore no-explicit-any
type AdminClient = SupabaseClient<any, 'public', any>;

/**
 * Push + email to the staff member the booking is assigned to (record.staff_id).
 * Account: business_members(business_id, staff_id).user_id, skipped when it is the owner
 * (the owner was already notified above). Email: that account's profile email, else
 * staff_private.email (staff without an account / web-only users still get the email).
 */
async function notifyAssignedStaff(
  admin: AdminClient,
  ctx: {
    record: AppointmentRow;
    businessName: string;
    timezone: string;
    ownerUserId: string;
    ownerEmail: string | null;
    contact: string;
    pending: boolean;
    fallbackLang: 'ro' | 'en';
  }
): Promise<{ sent_push: number; sent_email: boolean; reason: string }> {
  const { record } = ctx;
  if (!record.staff_id) return { sent_push: 0, sent_email: false, reason: 'no_staff' };

  const [{ data: members }, { data: priv }] = await Promise.all([
    admin
      .from('business_members')
      .select('user_id')
      .eq('business_id', record.business_id)
      .eq('staff_id', record.staff_id),
    admin.from('staff_private').select('email').eq('staff_id', record.staff_id).maybeSingle(),
  ]);
  const memberIds = ((members ?? []) as { user_id: string }[]).map((m) => m.user_id);
  if (memberIds.includes(ctx.ownerUserId)) {
    return { sent_push: 0, sent_email: false, reason: 'staff_is_owner' };
  }
  const userId = memberIds[0] ?? null;

  type StaffProfile = { email?: string | null; language?: string | null };
  const profile: StaffProfile | null = userId
    ? ((await admin.from('profiles').select('email, language').eq('id', userId).maybeSingle()).data as StaffProfile | null)
    : null;
  const lang = profile?.language ? parseNotifyLang(profile.language) : ctx.fallbackLang;
  const whenLabel = formatWhen(record.start_at, ctx.timezone, lang);
  const copy = messageStaffNewBooking(
    {
      businessName: ctx.businessName,
      contact: ctx.contact,
      serviceName: record.service_name ?? null,
      whenLabel,
      pending: ctx.pending,
      link: `${appWebBase()}/business/calendar`,
    },
    lang
  );

  // Push to the staff member's devices; tap opens the business calendar.
  let sentPush = 0;
  if (userId) {
    const { data: tokens } = await admin
      .from('device_push_tokens')
      .select('expo_push_token')
      .eq('user_id', userId);
    if (tokens?.length) {
      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(
            (tokens as { expo_push_token: string }[]).map((t) => ({
              to: t.expo_push_token,
              title: copy.pushTitle,
              body: copy.pushBody,
              sound: 'default',
              priority: 'high',
              channelId: 'cereri_heads',
              data: { screen: 'calendar', appointmentId: record.id, businessId: record.business_id },
            }))
          ),
        });
        const j = await res.json().catch(() => null);
        console.log('Staff push response', res.status, JSON.stringify(j));
        const tickets = Array.isArray(j?.data) ? j.data : [];
        sentPush = tickets.filter((t: { status?: string }) => t?.status === 'ok').length;
      } catch (e) {
        console.error('Staff push failed', e);
      }
    }
  }

  const email = profile?.email?.trim() || (priv as { email?: string | null } | null)?.email?.trim() || null;
  if (!email) return { sent_push: sentPush, sent_email: false, reason: 'staff_no_email' };
  if (ctx.ownerEmail && email.toLowerCase() === ctx.ownerEmail.toLowerCase()) {
    return { sent_push: sentPush, sent_email: false, reason: 'staff_email_is_owner' };
  }
  const r = await sendEmail(email, copy.subject, copy.text, { html: copy.html });
  await logNotification(
    { admin, type: 'STAFF_NEW_BOOKING', businessId: record.business_id, appointmentId: record.id },
    email,
    r
  );
  return { sent_push: sentPush, sent_email: r.ok, reason: r.ok ? 'ok' : 'staff_email_failed' };
}
