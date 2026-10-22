/**
 * Edge Function: google-calendar-sync
 *
 * Trei apelanți, fiecare cu autentificarea lui (fail-closed):
 * - x-webhook-secret (trigger DB appointment_gcal_push): o singură programare
 *   → creează/mută/șterge evenimentul din Google în 1–2 secunde.
 *   Body: { mode: 'appointment', appointment_id, business_id, deleted?, google_event_id? }
 * - x-cron-secret (pg_cron la 15 min, callback după conectare): sincronizare
 *   incrementală (syncToken) pentru toate conexiunile active sau doar { business_id }.
 * - JWT proprietar (butonul „Sincronizează acum”): sincronizare completă { business_id }.
 *
 * Tokenul de acces Google se refolosește până expiră; invalid_grant marchează
 * conexiunea „needs_reconnect” în loc de eroare generică.
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { authorizeCron, checkWebhookSecret } from '../_shared/secret-auth.ts';
import {
  appointmentEventBody,
  appointmentEventId,
  type BusyBlock,
  deleteEvent,
  eventToBlock,
  GoogleApiError,
  type GoogleEvent,
  googleEnv,
  isAppointmentEventId,
  isTokenFresh,
  listEvents,
  mapLimit,
  refreshAccessToken,
  SyncTokenExpiredError,
  upsertAppointmentEvent,
} from '../_shared/googleCalendar.ts';

const DAY = 86_400_000;
const PAST_DAYS = 7;
const FUTURE_DAYS = 90;
/** O sincronizare completă pe zi mută fereastra de 90 de zile și repară orice abatere. */
const FULL_RESYNC_MS = DAY;
const WRITE_CONCURRENCY = 5;
const DEFAULT_TZ = 'Europe/Bucharest';

type Env = { clientId: string; clientSecret: string; redirectUri: string };

type Conn = {
  business_id: string;
  google_calendar_id: string | null;
  refresh_token: string;
  status: string;
  sync_token: string | null;
  full_synced_at: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
};

type Biz = { id: string; name: string; owner_user_id: string; timezone: string | null };

type Apt = {
  id: string;
  business_id: string;
  status: string;
  start_at: string;
  end_at: string;
  service_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  google_event_id: string | null;
};

const APT_COLS = 'id, business_id, status, start_at, end_at, service_name, client_email, client_phone, google_event_id';
const CONN_COLS =
  'business_id, google_calendar_id, refresh_token, status, sync_token, full_synced_at, access_token, access_token_expires_at';

class NeedsReconnectError extends Error {
  constructor() {
    super('needs_reconnect');
  }
}

/** Sesiune Google per firmă: token din cache, reîmprospătat o singură dată la 401. */
class GoogleSession {
  private token: string | null;
  refreshed = false;
  constructor(
    private admin: SupabaseClient,
    private env: Env,
    private conn: Conn,
  ) {
    this.token = isTokenFresh(conn.access_token_expires_at) ? conn.access_token : null;
  }

  get calendarId(): string {
    return this.conn.google_calendar_id || 'primary';
  }

  private async refresh(): Promise<string> {
    const r = await refreshAccessToken(this.env, this.conn.refresh_token);
    if (!r.ok) {
      if (r.invalidGrant) {
        await this.admin
          .from('google_calendar_connections')
          .update({
            status: 'needs_reconnect',
            last_error: 'invalid_grant: accesul Google a fost revocat sau a expirat; reconectați Google Calendar',
            access_token: null,
            access_token_expires_at: null,
          })
          .eq('business_id', this.conn.business_id);
        throw new NeedsReconnectError();
      }
      throw new Error(`google_token_failed_${r.error}`);
    }
    this.token = r.accessToken;
    this.refreshed = true;
    const { error } = await this.admin
      .from('google_calendar_connections')
      .update({ access_token: r.accessToken, access_token_expires_at: r.expiresAt.toISOString() })
      .eq('business_id', this.conn.business_id);
    if (error) console.error('token cache save failed', error.message);
    return r.accessToken;
  }

  /** Rulează un apel Google; la 401 (token revocat/expirat) reîmprospătează și reîncearcă o dată. */
  async call<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = this.token ?? (await this.refresh());
    try {
      return await fn(token);
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 401) {
        this.token = null;
        return await fn(await this.refresh());
      }
      throw e;
    }
  }
}

async function loadContext(
  admin: SupabaseClient,
  businessId: string,
): Promise<Ctx> {
  const [bizRes, connRes] = await Promise.all([
    admin.from('business_profiles').select('id, name, owner_user_id, timezone').eq('id', businessId).maybeSingle(),
    admin.from('google_calendar_connections').select(CONN_COLS).eq('business_id', businessId).maybeSingle(),
  ]);
  if (bizRes.error) return { biz: null, conn: null, error: 'business_load_failed' };
  if (connRes.error) return { biz: null, conn: null, error: 'connection_load_failed' };
  return { biz: bizRes.data as Biz | null, conn: connRes.data as Conn | null };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// O programare (trigger)
// ---------------------------------------------------------------------------

async function syncAppointment(
  admin: SupabaseClient,
  env: Env,
  payload: { appointment_id?: string; business_id?: string; deleted?: boolean; google_event_id?: string | null },
): Promise<Response> {
  const started = Date.now();
  const businessId = payload.business_id ?? '';
  const appointmentId = payload.appointment_id ?? '';
  if (!businessId || !appointmentId) return jsonResponse({ error: 'invalid_payload' }, 400);

  const [ctx, aptRes] = await Promise.all([
    loadContext(admin, businessId),
    payload.deleted
      ? Promise.resolve({ data: null, error: null })
      : admin.from('appointments').select(APT_COLS).eq('id', appointmentId).maybeSingle(),
  ]);
  if (ctx.error || aptRes.error) return jsonResponse({ error: ctx.error ?? 'appointment_load_failed' }, 500);
  if (!ctx.biz || !ctx.conn || ctx.conn.status !== 'active') {
    return jsonResponse({ ok: true, skipped: 'not_connected' });
  }
  const session = new GoogleSession(admin, env, ctx.conn);
  const tz = ctx.biz.timezone ?? DEFAULT_TZ;

  try {
    if (payload.deleted) {
      const id = payload.google_event_id || appointmentEventId(appointmentId);
      await session.call((t) => deleteEvent(t, session.calendarId, id));
      console.log('gcal appointment', JSON.stringify({ action: 'deleted_row', ms: Date.now() - started }));
      return jsonResponse({ ok: true, action: 'removed' });
    }
    const apt = aptRes.data as Apt | null;
    if (!apt || apt.business_id !== businessId) return jsonResponse({ ok: true, skipped: 'not_found' });

    if (apt.status === 'approved') {
      const body = appointmentEventBody(apt, ctx.biz.name, tz);
      const eventId = await session.call((t) =>
        upsertAppointmentEvent(t, session.calendarId, apt.id, apt.google_event_id, body)
      );
      if (eventId !== apt.google_event_id) {
        const { error } = await admin.from('appointments').update({ google_event_id: eventId }).eq('id', apt.id);
        if (error) return jsonResponse({ error: 'link_failed' }, 500);
      }
      console.log('gcal appointment', JSON.stringify({ action: 'upserted', ms: Date.now() - started }));
      return jsonResponse({ ok: true, action: 'upserted' });
    }
    if (apt.status === 'cancelled' || apt.status === 'rejected') {
      const id = apt.google_event_id || appointmentEventId(apt.id);
      await session.call((t) => deleteEvent(t, session.calendarId, id));
      if (apt.google_event_id) {
        const { error } = await admin.from('appointments').update({ google_event_id: null }).eq('id', apt.id);
        if (error) return jsonResponse({ error: 'unlink_failed' }, 500);
      }
      console.log('gcal appointment', JSON.stringify({ action: 'removed', ms: Date.now() - started }));
      return jsonResponse({ ok: true, action: 'removed' });
    }
    return jsonResponse({ ok: true, skipped: 'status' });
  } catch (e) {
    if (e instanceof NeedsReconnectError) return jsonResponse({ error: 'needs_reconnect' }, 409);
    console.error('gcal appointment failed', errMsg(e));
    return jsonResponse({ error: errMsg(e) }, 502);
  }
}

// ---------------------------------------------------------------------------
// Sincronizare firmă (completă sau incrementală)
// ---------------------------------------------------------------------------

type SyncResult = {
  ok: boolean;
  mode: 'full' | 'incremental';
  imported: number;
  unblocked: number;
  pushed: number;
  pushFailed: number;
  updated: number;
  updateFailed: number;
  removed: number;
  removeFailed: number;
  errors: string[];
  ms: number;
};

async function syncBusiness(
  admin: SupabaseClient,
  env: Env,
  biz: Biz,
  conn: Conn,
  forceFull: boolean,
): Promise<SyncResult> {
  const started = Date.now();
  const session = new GoogleSession(admin, env, conn);
  const calendarId = session.calendarId;
  const tz = biz.timezone ?? DEFAULT_TZ;
  const now = new Date(started);
  const nowIso = now.toISOString();
  const timeMin = new Date(started - PAST_DAYS * DAY).toISOString();
  const timeMax = new Date(started + FUTURE_DAYS * DAY).toISOString();
  const errors: string[] = [];

  const fullDue = !conn.sync_token ||
    !conn.full_synced_at ||
    started - Date.parse(conn.full_synced_at) > FULL_RESYNC_MS;
  let full = forceFull || fullDue;

  // Citirile din DB (independente de Google) pornesc în paralel cu listarea.
  const ownP = admin
    .from('appointments')
    .select('google_event_id')
    .eq('business_id', biz.id)
    .not('google_event_id', 'is', null)
    .gte('end_at', new Date(started - (PAST_DAYS + 1) * DAY).toISOString());
  const toPushP = admin
    .from('appointments')
    .select(APT_COLS)
    .eq('business_id', biz.id)
    .eq('status', 'approved')
    .is('google_event_id', null)
    .gte('start_at', nowIso)
    .lte('start_at', timeMax)
    .order('start_at')
    .limit(100);
  const linkedP = admin
    .from('appointments')
    .select(APT_COLS)
    .eq('business_id', biz.id)
    .eq('status', 'approved')
    .not('google_event_id', 'is', null)
    .gte('start_at', nowIso)
    .lte('start_at', timeMax)
    .limit(200);
  const toRemoveP = admin
    .from('appointments')
    .select('id, google_event_id')
    .eq('business_id', biz.id)
    .in('status', ['cancelled', 'rejected'])
    .not('google_event_id', 'is', null)
    .limit(100);

  let listed: { items: GoogleEvent[]; nextSyncToken: string | null };
  try {
    listed = await session.call((t) =>
      listEvents(t, calendarId, full ? { timeMin, timeMax } : { syncToken: conn.sync_token })
    );
  } catch (e) {
    if (!(e instanceof SyncTokenExpiredError)) throw e;
    full = true; // 410: tokenul a expirat → listare completă.
    listed = await session.call((t) => listEvents(t, calendarId, { timeMin, timeMax }));
  }

  const [ownRes, toPushRes, linkedRes, toRemoveRes] = await Promise.all([ownP, toPushP, linkedP, toRemoveP]);
  for (const [name, r] of [['own', ownRes], ['push_list', toPushRes], ['linked', linkedRes], ['remove_list', toRemoveRes]] as const) {
    if (r.error) {
      console.error(`sync ${name} load failed`, r.error.message);
      errors.push(`${name}_load_failed`);
    }
  }
  const ownIds = new Set((ownRes.data ?? []).map((r) => r.google_event_id as string));
  const isOwn = (id: string) => ownIds.has(id) || isAppointmentEventId(id);

  // ---- Google → blocări ----
  const startMs = started - PAST_DAYS * DAY;
  const endMs = started + FUTURE_DAYS * DAY;
  const upserts: BusyBlock[] = [];
  const unblockIds: string[] = [];
  for (const ev of listed.items) {
    const b = eventToBlock(ev, biz.id, tz, isOwn, nowIso);
    const inWindow = b && Date.parse(b.end_at) > startMs && Date.parse(b.start_at) < endMs;
    if (b && inWindow) upserts.push(b);
    else if (!full) unblockIds.push(ev.id); // incremental: anulat / Disponibil / mutat în afara ferestrei
  }

  const dbOps: Promise<void>[] = [];
  if (upserts.length > 0) {
    dbOps.push(
      (async () => {
        const { error } = await admin.from('google_busy_blocks').upsert(upserts, { onConflict: 'business_id,google_event_id' });
        if (error) {
          console.error('sync blocks upsert failed', error.message);
          errors.push('blocks_upsert_failed');
        }
      })(),
    );
  }
  let unblocked = 0;
  if (full) {
    // Completă: tot ce nu mai e în Google (sau e prea vechi) dispare.
    dbOps.push(
      (async () => {
        const seen = new Set(upserts.map((b) => b.google_event_id));
        const { data, error } = await admin.from('google_busy_blocks').select('id, google_event_id, end_at').eq('business_id', biz.id);
        if (error) {
          errors.push('blocks_load_failed');
          return;
        }
        const stale = (data ?? [])
          .filter((b) => !seen.has(b.google_event_id) || Date.parse(b.end_at) <= startMs)
          .map((b) => b.id as string);
        for (let i = 0; i < stale.length; i += 200) {
          const { error: delErr } = await admin.from('google_busy_blocks').delete().in('id', stale.slice(i, i + 200));
          if (delErr) errors.push('stale_delete_failed');
          else unblocked += Math.min(200, stale.length - i);
        }
      })(),
    );
  } else if (unblockIds.length > 0) {
    dbOps.push(
      (async () => {
        for (let i = 0; i < unblockIds.length; i += 200) {
          const { error, count } = await admin
            .from('google_busy_blocks')
            .delete({ count: 'exact' })
            .eq('business_id', biz.id)
            .in('google_event_id', unblockIds.slice(i, i + 200));
          if (error) errors.push('unblock_failed');
          else unblocked += count ?? 0;
        }
      })(),
    );
  }

  // ---- Aplicație → Google (reconciliere; triggerul face asta în timp real) ----
  const toPush = (toPushRes.data ?? []) as Apt[];
  const pushResults = await mapLimit(toPush, WRITE_CONCURRENCY, (apt) =>
    session.call((t) =>
      upsertAppointmentEvent(t, calendarId, apt.id, null, appointmentEventBody(apt, biz.name, tz))
    )
  );
  const links: { id: string; google_event_id: string }[] = [];
  let pushed = 0;
  let pushFailed = 0;
  pushResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      pushed += 1;
      links.push({ id: toPush[i].id, google_event_id: r.value });
    }
    else {
      pushFailed += 1;
      console.error('sync push failed', errMsg(r.reason));
    }
  });

  // Programări mutate: completă → toate cele legate; incrementală → doar cele schimbate în Google.
  const googleById = new Map(
    listed.items.filter((ev) => ev.status !== 'cancelled' && ev.start?.dateTime && ev.end?.dateTime).map((ev) => [ev.id, ev]),
  );
  const toUpdate = ((linkedRes.data ?? []) as Apt[]).filter((apt) => {
    const ev = googleById.get(apt.google_event_id as string);
    if (!ev) return false;
    return Date.parse(ev.start!.dateTime!) !== Date.parse(apt.start_at) ||
      Date.parse(ev.end!.dateTime!) !== Date.parse(apt.end_at);
  });
  const updateResults = await mapLimit(toUpdate, WRITE_CONCURRENCY, (apt) =>
    session.call((t) =>
      upsertAppointmentEvent(t, calendarId, apt.id, apt.google_event_id, appointmentEventBody(apt, biz.name, tz))
    )
  );
  let updated = 0;
  let updateFailed = 0;
  updateResults.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      updated += 1;
      if (r.value !== toUpdate[i].google_event_id) links.push({ id: toUpdate[i].id, google_event_id: r.value });
    } else {
      updateFailed += 1;
      console.error('sync update failed', errMsg(r.reason));
    }
  });

  const toRemove = (toRemoveRes.data ?? []) as { id: string; google_event_id: string }[];
  const removeResults = await mapLimit(toRemove, WRITE_CONCURRENCY, (apt) =>
    session.call((t) => deleteEvent(t, calendarId, apt.google_event_id))
  );
  const unlinkIds: string[] = [];
  let removeFailed = 0;
  removeResults.forEach((r, i) => {
    // Ștergerea a eșuat: legătura rămâne, ca să reîncercăm data viitoare.
    if (r.status === 'fulfilled') unlinkIds.push(toRemove[i].id);
    else {
      removeFailed += 1;
      console.error('sync remove failed', errMsg(r.reason));
    }
  });

  // Actualizări în bloc: o singură cerere pentru legături, una pentru dezlegări.
  if (links.length > 0) {
    dbOps.push(
      (async () => {
        const { error } = await admin.rpc('gcal_link_events', { p_links: links });
        if (error) {
          console.error('sync link failed', error.message);
          errors.push('link_failed');
        }
      })(),
    );
  }
  let removed = 0;
  if (unlinkIds.length > 0) {
    dbOps.push(
      (async () => {
        const { error } = await admin.from('appointments').update({ google_event_id: null }).in('id', unlinkIds);
        if (error) {
          console.error('sync unlink failed', error.message);
          removeFailed += unlinkIds.length;
        } else removed = unlinkIds.length;
      })(),
    );
  }
  await Promise.all(dbOps);

  const stamp: Record<string, unknown> = { last_synced_at: new Date().toISOString(), last_error: null };
  if (listed.nextSyncToken) stamp.sync_token = listed.nextSyncToken;
  if (full) {
    stamp.full_synced_at = nowIso;
    if (!listed.nextSyncToken) stamp.sync_token = null;
  }
  const { error: stampErr } = await admin.from('google_calendar_connections').update(stamp).eq('business_id', biz.id);
  if (stampErr) {
    console.error('sync stamp failed', stampErr.message);
    errors.push('stamp_failed');
  }

  const result: SyncResult = {
    ok: errors.length === 0 && pushFailed + updateFailed + removeFailed === 0,
    mode: full ? 'full' : 'incremental',
    imported: upserts.length,
    unblocked,
    pushed,
    pushFailed,
    updated,
    updateFailed,
    removed,
    removeFailed,
    errors,
    ms: Date.now() - started,
  };
  console.log(
    'gcal sync',
    JSON.stringify({ business: biz.id, ...result, changes: listed.items.length, tokenRefreshed: session.refreshed }),
  );
  return result;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type Payload = {
  mode?: string;
  business_id?: string;
  appointment_id?: string;
  deleted?: boolean;
  google_event_id?: string | null;
};

type Ctx = { biz: Biz | null; conn: Conn | null; error?: string };

async function runOne(admin: SupabaseClient, env: Env, ctx: Ctx, forceFull: boolean): Promise<Response> {
  if (ctx.error) return jsonResponse({ error: ctx.error }, 500);
  if (!ctx.biz) return jsonResponse({ error: 'business_not_found' }, 404);
  if (!ctx.conn) return jsonResponse({ error: 'not_connected' }, 400);
  if (ctx.conn.status !== 'active') return jsonResponse({ error: 'needs_reconnect' }, 409);
  try {
    return jsonResponse(await syncBusiness(admin, env, ctx.biz, ctx.conn, forceFull));
  } catch (e) {
    if (e instanceof NeedsReconnectError) return jsonResponse({ error: 'needs_reconnect' }, 409);
    console.error('gcal sync failed', ctx.biz.id, errMsg(e));
    return jsonResponse({ error: errMsg(e) }, 502);
  }
}

/** Cron: toate conexiunile active, câte 2 firme simultan. */
async function runAll(admin: SupabaseClient, env: Env): Promise<Response> {
  const { data, error } = await admin
    .from('google_calendar_connections')
    .select(CONN_COLS)
    .eq('status', 'active');
  if (error) return jsonResponse({ error: 'connection_load_failed' }, 500);
  const conns = (data ?? []) as Conn[];
  if (conns.length === 0) return jsonResponse({ ok: true, businesses: 0 });
  const { data: bizRows, error: bizErr } = await admin
    .from('business_profiles')
    .select('id, name, owner_user_id, timezone')
    .in('id', conns.map((c) => c.business_id));
  if (bizErr) return jsonResponse({ error: 'business_load_failed' }, 500);
  const bizById = new Map(((bizRows ?? []) as Biz[]).map((b) => [b.id, b]));
  const results = await mapLimit(conns, 2, async (conn) => {
    const biz = bizById.get(conn.business_id);
    if (!biz) return { business: conn.business_id, ok: false, error: 'business_not_found' };
    try {
      const r = await syncBusiness(admin, env, biz, conn, false);
      return { business: conn.business_id, ok: r.ok, mode: r.mode, ms: r.ms };
    } catch (e) {
      if (!(e instanceof NeedsReconnectError)) console.error('gcal cron sync failed', conn.business_id, errMsg(e));
      return { business: conn.business_id, ok: false, error: errMsg(e) };
    }
  });
  const summary = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: errMsg(r.reason) }));
  return jsonResponse({ ok: summary.every((s) => s.ok), businesses: summary.length, results: summary });
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const env = googleEnv();
  if (!env) return jsonResponse({ error: 'google_not_configured' }, 500);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  let payload: Payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // 1) Trigger DB (o programare): x-webhook-secret.
  if (req.headers.has('x-webhook-secret')) {
    const w = checkWebhookSecret(req);
    if (w === 'missing') return jsonResponse({ error: 'server_misconfigured' }, 500);
    if (w !== 'ok') return jsonResponse({ error: 'unauthorized' }, 401);
    return await syncAppointment(admin, env, payload);
  }

  // 2) pg_cron / callback după conectare: x-cron-secret → incremental.
  if (req.headers.has('x-cron-secret')) {
    const c = authorizeCron(req);
    if (!c.ok) return jsonResponse({ error: c.error }, c.status);
    return payload.business_id
      ? await runOne(admin, env, await loadContext(admin, payload.business_id), false)
      : await runAll(admin, env);
  }

  // 3) Butonul din aplicație: JWT-ul proprietarului → sincronizare completă.
  const businessId = payload.business_id ?? '';
  if (!businessId) return jsonResponse({ error: 'invalid_payload' }, 400);
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const [{ data: userData, error: userErr }, ctx] = await Promise.all([
    userClient.auth.getUser(),
    loadContext(admin, businessId),
  ]);
  if (userErr || !userData.user) return jsonResponse({ error: 'unauthorized' }, 401);
  if (ctx.biz && ctx.biz.owner_user_id !== userData.user.id) return jsonResponse({ error: 'forbidden' }, 403);
  return await runOne(admin, env, ctx, true);
});
