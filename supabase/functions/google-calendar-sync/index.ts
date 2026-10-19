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
  updateEvent,
} from '../_shared/googleCalendar.ts';

/** Miezul nopții local (YYYY-MM-DD) într-un fus orar → instant UTC. */
function zonedDayStartUtc(dateYmd: string, timeZone: string): Date {
  const dayMs = Date.parse(`${dateYmd}T00:00:00Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const offsetAt = (utcMs: number): number => {
    const parts = fmt.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc =
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return asUtc - utcMs;
  };
  // Offsetul la prânzul zilei căutate (evită orele ambigue de la DST de noapte).
  const offset = offsetAt(dayMs + 12 * 3_600_000);
  return new Date(dayMs - offset);
}

function addDaysYmd(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

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
  const errors: string[] = [];

  const { data: business, error: bizErr } = await admin
    .from('business_profiles')
    .select('id, name, owner_user_id, timezone')
    .eq('id', businessId)
    .maybeSingle();
  if (bizErr) return jsonResponse({ error: 'business_load_failed' }, 500);
  if (!business) return jsonResponse({ error: 'business_not_found' }, 404);
  if (business.owner_user_id !== user.id) return jsonResponse({ error: 'forbidden' }, 403);

  const { data: conn, error: connErr } = await admin
    .from('google_calendar_connections')
    .select('google_calendar_id, refresh_token')
    .eq('business_id', businessId)
    .maybeSingle();
  if (connErr) return jsonResponse({ error: 'connection_load_failed' }, 500);
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
  const { data: ownEvents, error: ownErr } = await admin
    .from('appointments')
    .select('google_event_id')
    .eq('business_id', businessId)
    .not('google_event_id', 'is', null);
  if (ownErr) {
    console.error('sync own events load failed', ownErr.message);
    errors.push('own_events_load_failed');
  }
  const ownIds = new Set((ownEvents ?? []).map((r) => r.google_event_id as string));

  const bizTz = business.timezone ?? 'Europe/Bucharest';
  const blocks = events
    .filter((ev) => ev.status !== 'cancelled')
    .filter((ev) => !ownIds.has(ev.id))
    .flatMap((ev) => {
      // Evenimente cu oră: blocul copiază intervalul.
      if (ev.start?.dateTime && ev.end?.dateTime) {
        return [
          {
            business_id: businessId,
            google_event_id: ev.id,
            start_at: ev.start.dateTime,
            end_at: ev.end.dateTime,
            updated_at: new Date().toISOString(),
          },
        ];
      }
      // Evenimente de o zi întreagă (concedii, zile libere): blochează
      // zilele întregi pe calendarul firmei, nu sunt ignorate.
      if (ev.start?.date && !ev.start.dateTime) {
        const startDay = ev.start.date;
        const endDay = ev.end?.date ?? addDaysYmd(startDay, 1);
        const startMs = zonedDayStartUtc(startDay, bizTz).getTime();
        const endMs = zonedDayStartUtc(endDay, bizTz).getTime();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
        return [
          {
            business_id: businessId,
            google_event_id: ev.id,
            start_at: new Date(startMs).toISOString(),
            end_at: new Date(endMs).toISOString(),
            updated_at: new Date().toISOString(),
          },
        ];
      }
      return [];
    });

  if (blocks.length > 0) {
    const { error: upErr } = await admin
      .from('google_busy_blocks')
      .upsert(blocks, { onConflict: 'business_id,google_event_id' });
    if (upErr) return jsonResponse({ error: upErr.message }, 500);
  }

  // Șterge blocările dispărute din Google în fereastra sincronizată.
  const seen = new Set(blocks.map((b) => b.google_event_id));
  const { data: existingBlocks, error: blocksErr } = await admin
    .from('google_busy_blocks')
    .select('id, google_event_id')
    .eq('business_id', businessId)
    .gte('start_at', timeMin)
    .lte('start_at', timeMax);
  if (blocksErr) {
    console.error('sync blocks load failed', blocksErr.message);
    errors.push('blocks_load_failed');
  } else {
    const staleIds = (existingBlocks ?? [])
      .filter((b) => !seen.has(b.google_event_id))
      .map((b) => b.id);
    if (staleIds.length > 0) {
      const { error: staleErr } = await admin.from('google_busy_blocks').delete().in('id', staleIds);
      if (staleErr) {
        console.error('sync stale delete failed', staleErr.message);
        errors.push('stale_delete_failed');
      }
    }
  }

  // Trimite programările aprobate viitoare care încă nu sunt în Google.
  const { data: toPush, error: pushListErr } = await admin
    .from('appointments')
    .select('id, start_at, end_at, service_name, client_email, client_phone')
    .eq('business_id', businessId)
    .eq('status', 'approved')
    .is('google_event_id', null)
    .gte('start_at', now.toISOString())
    .lte('start_at', timeMax)
    .limit(100);
  if (pushListErr) {
    console.error('sync push list failed', pushListErr.message);
    errors.push('push_list_failed');
  }

  let pushed = 0;
  let pushFailed = 0;
  for (const apt of toPush ?? []) {
    try {
      const eventId = await createEvent(accessToken, calendarId, {
        summary: `${business.name}: ${apt.service_name ?? 'Programare'}`,
        description: [apt.client_email, apt.client_phone].filter(Boolean).join(' '),
        start: { dateTime: apt.start_at, timeZone: business.timezone ?? 'Europe/Bucharest' },
        end: { dateTime: apt.end_at, timeZone: business.timezone ?? 'Europe/Bucharest' },
      });
      const { error: linkErr } = await admin
        .from('appointments')
        .update({ google_event_id: eventId })
        .eq('id', apt.id);
      if (linkErr) {
        // Fără legătură salvată, evenimentul ar fi duplicat la următoarea
        // sincronizare — îl ștergem înapoi din Google.
        await deleteEvent(accessToken, calendarId, eventId).catch(() => {});
        pushFailed += 1;
        continue;
      }
      pushed += 1;
    } catch (e) {
      // Un eveniment eșuat nu oprește restul sincronizării, dar se raportează.
      console.error('sync push failed', e instanceof Error ? e.message : e);
      pushFailed += 1;
    }
  }

  // Actualizează evenimentele Google ale programărilor reprogramate:
  // dacă ora din Google diferă de ora curentă din DB, o corectăm prin PATCH.
  const googleById = new Map(
    events
      .filter((ev) => ev.start?.dateTime && ev.end?.dateTime)
      .map((ev) => [ev.id, ev]),
  );
  const { data: toUpdate, error: updateListErr } = await admin
    .from('appointments')
    .select('id, start_at, end_at, service_name, client_email, client_phone, google_event_id')
    .eq('business_id', businessId)
    .eq('status', 'approved')
    .not('google_event_id', 'is', null)
    .gte('start_at', now.toISOString())
    .lte('start_at', timeMax)
    .limit(100);
  if (updateListErr) {
    console.error('sync update list failed', updateListErr.message);
    errors.push('update_list_failed');
  }
  let updated = 0;
  let updateFailed = 0;
  for (const apt of toUpdate ?? []) {
    const ev = googleById.get(apt.google_event_id as string);
    if (!ev) continue;
    const sameStart = Date.parse(ev.start!.dateTime!) === Date.parse(apt.start_at);
    const sameEnd = Date.parse(ev.end!.dateTime!) === Date.parse(apt.end_at);
    if (sameStart && sameEnd) continue;
    try {
      await updateEvent(accessToken, calendarId, apt.google_event_id as string, {
        summary: `${business.name}: ${apt.service_name ?? 'Programare'}`,
        description: [apt.client_email, apt.client_phone].filter(Boolean).join(' '),
        start: { dateTime: apt.start_at, timeZone: business.timezone ?? 'Europe/Bucharest' },
        end: { dateTime: apt.end_at, timeZone: business.timezone ?? 'Europe/Bucharest' },
      });
      updated += 1;
    } catch (e) {
      // Rămâne ora veche în Google; reîncercăm la următoarea sincronizare.
      console.error('sync update failed', e instanceof Error ? e.message : e);
      updateFailed += 1;
    }
  }

  // Scoate din Google programările anulate/respinse care fuseseră trimise.
  const { data: toRemove, error: removeListErr } = await admin
    .from('appointments')
    .select('id, google_event_id')
    .eq('business_id', businessId)
    .in('status', ['cancelled', 'rejected'])
    .not('google_event_id', 'is', null)
    .limit(100);
  if (removeListErr) {
    console.error('sync remove list failed', removeListErr.message);
    errors.push('remove_list_failed');
  }
  let removed = 0;
  let removeFailed = 0;
  for (const apt of toRemove ?? []) {
    try {
      await deleteEvent(accessToken, calendarId, apt.google_event_id as string);
    } catch (e) {
      // Ștergerea a eșuat: păstrăm legătura ca să reîncercăm data viitoare,
      // în loc să lăsăm evenimentul orfan în Google.
      console.error('sync remove failed', e instanceof Error ? e.message : e);
      removeFailed += 1;
      continue;
    }
    const { error: unlinkErr } = await admin
      .from('appointments')
      .update({ google_event_id: null })
      .eq('id', apt.id);
    if (unlinkErr) {
      console.error('sync unlink failed', unlinkErr.message);
      removeFailed += 1;
      continue;
    }
    removed += 1;
  }

  const { error: stampErr } = await admin
    .from('google_calendar_connections')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('business_id', businessId);
  if (stampErr) {
    console.error('sync stamp failed', stampErr.message);
    errors.push('stamp_failed');
  }

  const failedTotal = pushFailed + updateFailed + removeFailed;
  const ok = errors.length === 0 && failedTotal === 0;
  if (!ok) {
    console.error('sync partial', JSON.stringify({ errors, pushFailed, updateFailed, removeFailed }));
  }
  return jsonResponse({
    ok,
    imported: blocks.length,
    pushed,
    pushFailed,
    updated,
    updateFailed,
    removed,
    removeFailed,
    errors,
  });
});
