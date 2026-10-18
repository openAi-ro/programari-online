/**
 * Edge Function: notify-waitlist
 *
 * Body: { business_id, desired_date: 'YYYY-MM-DD', booking_url }
 * Auth: JWT of business owner or a client of that business.
 *
 * Notifies active waitlist entries for that local date (email/WhatsApp).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  messageWaitlistSpot,
  notifyClientChannels,
  parseNotifyLang,
} from '../_shared/notify.ts';

type Payload = {
  business_id?: string;
  desired_date?: string;
  booking_url?: string;
  lang?: string;
  waitlist_id?: string;
};

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

  const businessId = payload.business_id;
  const desiredDate = payload.desired_date;
  const bookingUrl = (payload.booking_url ?? '').trim();
  const waitlistId = (payload.waitlist_id ?? '').trim() || null;

  if (!businessId || !desiredDate || !/^\d{4}-\d{2}-\d{2}$/.test(desiredDate)) {
    return jsonResponse({ error: 'invalid_payload' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
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

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: business } = await admin
    .from('business_profiles')
    .select('id, name, owner_user_id, public_code')
    .eq('id', businessId)
    .maybeSingle();

  if (!business) {
    return jsonResponse({ error: 'business_not_found' }, 404);
  }

  const isOwner = business.owner_user_id === user.id;
  if (!isOwner) {
    const { data: asClient } = await admin
      .from('appointments')
      .select('id')
      .eq('business_id', businessId)
      .eq('client_user_id', user.id)
      .limit(1)
      .maybeSingle();
    if (!asClient) {
      return jsonResponse({ error: 'forbidden' }, 403);
    }
  }

  const { data: rows, error: listErr } = await admin
    .from('waitlist')
    .select('id, client_user_id, client_email, client_phone')
    .eq('business_id', businessId)
    .eq('desired_date', desiredDate)
    .eq('status', 'active')
    .limit(20);

  if (listErr) {
    return jsonResponse({ error: listErr.message }, 500);
  }

  const list = (rows ?? []).filter((row) => !waitlistId || row.id === waitlistId);
  const outcomes: { id: string; ok: boolean }[] = [];
  const link =
    bookingUrl ||
    `programari://b/${business.public_code}`;
  const fallbackLang = parseNotifyLang(payload.lang);

  for (const row of list) {
    const { data: profile } = await admin
      .from('profiles')
      .select('email, phone, language')
      .eq('id', row.client_user_id)
      .maybeSingle();

    const email = row.client_email ?? profile?.email ?? null;
    const phone = row.client_phone ?? profile?.phone ?? null;
    const lang = parseNotifyLang(
      (profile as { language?: string } | null)?.language ?? fallbackLang
    );
    const copy = messageWaitlistSpot(business.name, desiredDate, link, lang);

    const results = await notifyClientChannels({
      email,
      phone,
      subject: copy.subject,
      text: copy.text,
      wa: copy.wa,
      log: { admin, type: 'WAITLIST', businessId },
    });

    const delivered = results.some((r) => r.ok && !r.stub);
    if (!delivered) {
      outcomes.push({ id: row.id, ok: false });
      continue;
    }
    await admin
      .from('waitlist')
      .update({
        status: 'notified',
        notified_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'active');

    outcomes.push({ id: row.id, ok: true });
  }

  return jsonResponse({
    ok: true,
    notified: outcomes.filter((o) => o.ok).length,
    outcomes,
  });
});
