/**
 * Edge Function: send-reminders
 *
 * Cron every 1–5 minutes:
 * 1) 24h before: approved, reminder_24h_sent=false, start_at in now+23.5h … now+24.5h
 * 2) 30min before: approved, reminder_sent=false, start_at in now+25m .. now+35m.
 *
 * Invoke with service role (cron / scheduled function).
 *
 * Reads and reminder flags go straight to Postgres (SUPABASE_DB_URL), not through
 * the REST gateway: the gateway exchanges the sb_secret key for a freshly minted JWT
 * per request, and on the Dublin edge a few % of those were rejected by PostgREST
 * with "JWT issued at future". The cron job (pg_cron jobid 1) only calls this
 * function when an appointment is due in one of the windows below.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import postgres from 'npm:postgres@3.4.5';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { authorizeCron } from '../_shared/secret-auth.ts';
import {
  messageReminder,
  messageReminder24h,
  notifyClientChannels,
  notifyLocale,
  parseNotifyLang,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

function formatTimeLocal(iso: string, timezone: string, lang: 'ro' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(notifyLocale(lang), {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

type Sql = ReturnType<typeof postgres>;

type DueRow = {
  id: string;
  business_id: string;
  client_user_id: string | null;
  client_email: string | null;
  client_phone: string | null;
  start_at: string;
  notify_reminders: boolean | null;
  notify_whatsapp: boolean | null;
  language: string | null;
  profile_phone: string | null;
  business_name: string | null;
  timezone: string | null;
};

async function processWindow(
  sql: Sql,
  admin: Admin,
  opts: {
    from: string;
    to: string;
    flag: 'reminder_sent' | 'reminder_24h_sent';
    kind: '30min' | '24h';
  }
): Promise<{ id: string; ok: boolean; detail?: string; kind: string }[]> {
  const list = await sql<DueRow[]>`
    select a.id, a.business_id, a.client_user_id, a.client_email, a.client_phone,
           to_char(a.start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as start_at,
           p.notify_reminders, p.notify_whatsapp, p.language, p.phone as profile_phone,
           b.name as business_name, b.timezone
      from public.appointments a
      left join public.profiles p on p.id = a.client_user_id
      left join public.business_profiles b on b.id = a.business_id
     where a.status = 'approved'
       and a.${sql(opts.flag)} = false
       and a.start_at >= ${opts.from}::timestamptz
       and a.start_at <= ${opts.to}::timestamptz`;

  const outcomes: { id: string; ok: boolean; detail?: string; kind: string }[] = [];

  const markSent = (id: string) =>
    sql`update public.appointments
           set ${sql(opts.flag)} = true, updated_at = now()
         where id = ${id} and ${sql(opts.flag)} = false`;

  for (const appt of list) {
    const wantsReminder = !appt.client_user_id || appt.notify_reminders !== false;

    if (!wantsReminder) {
      await markSent(appt.id);
      outcomes.push({ id: appt.id, ok: true, kind: opts.kind, detail: 'opted_out' });
      continue;
    }

    const businessName = appt.business_name ?? 'business';
    const timezone = appt.timezone ?? 'Europe/Bucharest';
    const lang: 'ro' | 'en' = appt.client_user_id ? parseNotifyLang(appt.language) : 'ro';
    const timeLocal = formatTimeLocal(appt.start_at, timezone, lang);
    const copy =
      opts.kind === '24h'
        ? messageReminder24h(businessName, timeLocal, timezone, lang)
        : messageReminder(businessName, timeLocal, timezone, lang);

    try {
      const wantsWhatsapp = !appt.client_user_id || appt.notify_whatsapp !== false;
      const phone =
        appt.client_phone && `${appt.client_phone}`.trim()
          ? appt.client_phone
          : appt.client_user_id
            ? appt.profile_phone ?? null
            : null;
      await notifyClientChannels({
        email: appt.client_email,
        phone: wantsWhatsapp ? phone : null,
        subject: copy.subject,
        text: copy.text,
        wa: copy.wa,
        log: {
          admin,
          type: opts.kind === '24h' ? 'REMINDER_24H' : 'REMINDER_SOON',
          businessId: appt.business_id,
          appointmentId: appt.id,
        },
      });

      // Best-effort client push (even if email/phone missing); do not fail reminder
      if (appt.client_user_id) {
        try {
          await sendExpoPushToUser(admin, appt.client_user_id, {
            title: copy.subject,
            body: copy.text,
            channelId: 'cereri_heads',
            data: { screen: 'my-appointments', appointmentId: appt.id },
          });
        } catch (pushErr) {
          console.error('reminder push failed', appt.id, pushErr);
        }
      }

      await markSent(appt.id);
      outcomes.push({ id: appt.id, ok: true, kind: opts.kind });
    } catch (e) {
      await markSent(appt.id);
      outcomes.push({
        id: appt.id,
        ok: false,
        kind: opts.kind,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return outcomes;
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const cronAuth = authorizeCron(req);
  if (!cronAuth.ok) {
    return jsonResponse({ error: cronAuth.error }, cronAuth.status);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const dbUrl = Deno.env.get('SUPABASE_DB_URL');
  if (!supabaseUrl || !serviceKey || !dbUrl) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  // admin is still used by the shared helpers (notification_log, push tokens).
  const admin = createClient(supabaseUrl, serviceKey);
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  const now = Date.now();

  const window30min = {
    from: new Date(now + 25 * 60 * 1000).toISOString(),
    to: new Date(now + 35 * 60 * 1000).toISOString(),
  };
  const window24h = {
    from: new Date(now + 23.5 * 60 * 60 * 1000).toISOString(),
    to: new Date(now + 24.5 * 60 * 60 * 1000).toISOString(),
  };

  try {
    const [outcomes24h, outcomes30min] = await Promise.all([
      processWindow(sql, admin, {
        from: window24h.from,
        to: window24h.to,
        flag: 'reminder_24h_sent',
        kind: '24h',
      }),
      processWindow(sql, admin, {
        from: window30min.from,
        to: window30min.to,
        flag: 'reminder_sent',
        kind: '30min',
      }),
    ]);

    const outcomes = [...outcomes24h, ...outcomes30min];
    return jsonResponse({
      ok: true,
      window_24h: window24h,
      window_30min: window30min,
      processed: outcomes.length,
      outcomes,
    });
  } catch (e) {
    console.error('send-reminders failed', e);
    return jsonResponse(
      { error: e instanceof Error ? e.message : String(e) },
      500
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
});
