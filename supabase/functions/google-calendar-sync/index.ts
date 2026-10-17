/**
 * Edge Function: google-calendar-sync
 * Body: { business_id }
 * Auth: JWT al proprietarului firmei.
 *
 * Trage evenimentele personale (90 zile înainte/înainte) în google_busy_blocks
 * și trimite programările aprobate viitoare în Google Calendar.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  createEvent,
  deleteEvent,
  googleEnv,
  listEvents,
  refreshAccessToken,
} from '../_shared/googleCalendar.ts';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const env = googleEnv();
  if (!env) return jsonResponse({ error: 'google_not_configured' }, 500);

  let payload: { business_id?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const businessId = payload.business_id ?? '';
  if (!businessId) return jsonResponse({ error: 'invalid_payload' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) return jsonResponse({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: business } = await admin
    .from('business_profiles')
    .select('id, name, owner_user_id, timezone')
    .eq('id', businessId)
    .maybeSingle();
  if (!business) return jsonResponse({ error: 'business_not_found' }, 404);
  if (business.owner_user_id !== user.id) return jsonResponse({ error: 'forbidden' }, 403);

  const { data: conn } = await admin
    .from('google_calendar_connections')
    .select('google_calendar_id, refresh_token')
    .eq('business_id', businessId)
    .maybeSingle();
  if (!conn) return jsonResponse({ error: 'not_connected' }, 400);

  const accessToken = await refreshAccessToken(env, conn.refresh_token);
  if (!accessToken) return jsonResponse({ error: 'google_token_failed' }, 502);

  const calendarId = conn.google_calendar_id || 'primary';
  const now = new Date();
  const timeMin = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const timeMax = new Date(now.getTime() + 90 * 86_400_000).toISOString();

  let events;
  try {
    events = await listEvents(accessToken, calendarId, timeMin, timeMax);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : 'google_list_failed' }, 502);
  }

  // Programările trimise deja în Google nu se reimportă ca blocări.
  const { data: ownEvents } = await admin
    .from('appointments')
    .select('google_event_id')
    .eq('business_id', businessId)
    .not('google_event_id', 'is', null);
  const ownIds = new Set((ownEvents ?? []).map((r) => r.google_event_id as string));

  const blocks = events
    .filter((ev) => ev.status !== 'cancelled' && ev.start?.dateTime && ev.end?.dateTime)
    .filter((ev) => !ownIds.has(ev.id))
    .map((ev) => ({
      business_id: businessId,
      google_event_id: ev.id,
      start_at: ev.start!.dateTime!,
      end_at: ev.end!.dateTime!,
      updated_at: new Date().toISOString(),
    }));

  if (blocks.length > 0) {
    const { error: upErr } = await admin
      .from('google_busy_blocks')
      .upsert(blocks, { onConflict: 'business_id,google_event_id' });
    if (upErr) return jsonResponse({ error: upErr.message }, 500);
  }

  // Șterge blocările dispărute din Google în fereastra sincronizată.
  const seen = new Set(blocks.map((b) => b.google_event_id));
  const { data: existingBlocks } = await admin
    .from('google_busy_blocks')
    .select('id, google_event_id')
    .eq('business_id', businessId)
    .gte('start_at', timeMin)
    .lte('start_at', timeMax);
  const staleIds = (existingBlocks ?? [])
    .filter((b) => !seen.has(b.google_event_id))
    .map((b) => b.id);
  if (staleIds.length > 0) {
    await admin.from('google_busy_blocks').delete().in('id', staleIds);
  }

  // Trimite programările aprobate viitoare care încă nu sunt în Google.
  const { data: toPush } = await admin
    .from('appointments')
    .select('id, start_at, end_at, service_name, client_email, client_phone')
    .eq('business_id', businessId)
    .eq('status', 'approved')
    .is('google_event_id', null)
    .gte('start_at', now.toISOString())
    .lte('start_at', timeMax)
    .limit(100);

  let pushed = 0;
  for (const apt of toPush ?? []) {
    try {
      const eventId = await createEvent(accessToken, calendarId, {
        summary: `${business.name}: ${apt.service_name ?? 'Programare'}`,
        description: [apt.client_email, apt.client_phone].filter(Boolean).join(' '),
        start: { dateTime: apt.start_at, timeZone: business.timezone ?? 'Europe/Bucharest' },
        end: { dateTime: apt.end_at, timeZone: business.timezone ?? 'Europe/Bucharest' },
      });
      await admin.from('appointments').update({ google_event_id: eventId }).eq('id', apt.id);
      pushed += 1;
    } catch {
      // Un eveniment eșuat nu oprește restul sincronizării.
    }
  }

  // Scoate din Google programările anulate/respinse care fuseseră trimise.
  const { data: toRemove } = await admin
    .from('appointments')
    .select('id, google_event_id')
    .eq('business_id', businessId)
    .in('status', ['cancelled', 'rejected'])
    .not('google_event_id', 'is', null)
    .limit(100);
  for (const apt of toRemove ?? []) {
    try {
      await deleteEvent(accessToken, calendarId, apt.google_event_id as string);
    } catch {
      // Eveniment deja șters în Google.
    }
    await admin.from('appointments').update({ google_event_id: null }).eq('id', apt.id);
  }

  await admin
    .from('google_calendar_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('business_id', businessId);

  return jsonResponse({ ok: true, imported: blocks.length, pushed });
});
