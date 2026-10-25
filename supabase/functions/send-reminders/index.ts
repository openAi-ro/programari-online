/**
 * Edge Function: send-reminders
 *
 * Cron every 1–5 minutes:
 * 1) 24h before: approved, reminder_24h_sent=false, start_at in now+23.5h … now+24.5h
 * 2) ~1h before ("soon", flag reminder_sent): approved, reminder_sent=false, start_at in
 *    (now+15m, now+65m], confirmation sent >= 20 min ago. Normal bookings are picked 60-65 min
 *    before (text "într-o oră"); late bookings get a catch-up once the 20 min have passed (text
 *    "în curând, azi la ora HH:MM"). Rules and tests: ./windows.ts, ./windows.test.ts.
 *    Confirmation time = latest CONFIRMED row in notification_log for the appointment (written
 *    when the client is told it was approved, also for owner approvals of pending requests),
 *    else appointments.created_at (auto-approved bookings, clients without email/phone).
 * 3) Retry: a channel (email / WhatsApp) whose send failed is retried on the next runs while
 *    the appointment is still in its window, up to 3 attempts; a channel already sent is never
 *    sent again. Rules and tests: ./retry.ts, ./retry.test.ts.
 *    Each channel's notification_log row is reserved ('sending') BEFORE the provider call and
 *    updated with the outcome after it; a row left in 'sending' (run died / log update failed)
 *    counts as sent, so a message is never sent twice (at most once).
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
  maskRecipient,
  messageReminder,
  messageReminder24h,
  notificationLogResult,
  notifyLocale,
  parseNotifyLang,
  sendEmail,
  sendWhatsApp,
  type SendResult,
  waTemplateName,
} from '../_shared/notify.ts';
import { soonKind, soonWindow } from './windows.ts';
import { type Channel, channelsToSend, failedChannels, isFirstAttempt, shouldRetry } from './retry.ts';
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
    kind: 'soon' | '24h';
    /** soon only: confirmation must be at or before this */
    confirmedBefore?: string;
    nowMs: number;
  }
): Promise<{ id: string; ok: boolean; detail?: string; kind: string }[]> {
  const confirmedFilter =
    opts.kind === 'soon'
      ? sql`and coalesce(
               (select max(l.created_at) from public.notification_log l
                 where l.appointment_id = a.id and l.type = 'CONFIRMED'),
               a.created_at) <= ${opts.confirmedBefore!}::timestamptz`
      : sql``;
  const startFrom =
    opts.kind === 'soon'
      ? sql`a.start_at > ${opts.from}::timestamptz`
      : sql`a.start_at >= ${opts.from}::timestamptz`;
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
       and ${startFrom}
       and a.start_at <= ${opts.to}::timestamptz
       ${confirmedFilter}`;

  const outcomes: { id: string; ok: boolean; detail?: string; kind: string }[] = [];

  // Claim before sending: only the run that flips the flag sends (no double send if two
  // invocations overlap). If a channel failed and has attempts left, release() clears the
  // flag again so the next run retries only that channel (see ./retry.ts).
  const claim = async (id: string): Promise<boolean> => {
    const rows = await sql`update public.appointments
           set ${sql(opts.flag)} = true, updated_at = now()
         where id = ${id} and ${sql(opts.flag)} = false
         returning id`;
    return rows.length > 0;
  };
  const release = async (id: string): Promise<void> => {
    await sql`update public.appointments
           set ${sql(opts.flag)} = false, updated_at = now()
         where id = ${id} and ${sql(opts.flag)} = true`;
  };
  const logType = opts.kind === '24h' ? 'REMINDER_24H' : 'REMINDER_SOON';

  // The old Meta template REMINDER_SOON says "in about 30 minutes"; the soon reminder only
  // goes to WhatsApp once a REMINDER_1H template is configured (WHATSAPP_TPL_REMINDER_1H).
  const soonWhatsappReady = opts.kind !== 'soon' || waTemplateName('REMINDER_1H') !== null;

  for (const appt of list) {
    if (!(await claim(appt.id))) continue;
    const wantsReminder = !appt.client_user_id || appt.notify_reminders !== false;

    if (!wantsReminder) {
      outcomes.push({ id: appt.id, ok: true, kind: opts.kind, detail: 'opted_out' });
      continue;
    }

    const businessName = appt.business_name ?? 'business';
    const timezone = appt.timezone ?? 'Europe/Bucharest';
    const lang: 'ro' | 'en' = appt.client_user_id ? parseNotifyLang(appt.language) : 'ro';
    const timeLocal = formatTimeLocal(appt.start_at, timezone, lang);
    const soon = opts.kind === 'soon' ? soonKind(Date.parse(appt.start_at), opts.nowMs) : null;
    const copy =
      opts.kind === '24h'
        ? messageReminder24h(businessName, timeLocal, timezone, lang)
        : messageReminder(businessName, timeLocal, timezone, lang, soon!);

    try {
      const wantsWhatsapp =
        soonWhatsappReady && (!appt.client_user_id || appt.notify_whatsapp !== false);
      const phone =
        appt.client_phone && `${appt.client_phone}`.trim()
          ? appt.client_phone
          : appt.client_user_id
            ? appt.profile_phone ?? null
            : null;
      const planned: Channel[] = [];
      if (appt.client_email) planned.push('email');
      if (wantsWhatsapp && phone) planned.push('whatsapp');
      const log = await sql<{ channel: string; status: string | null }[]>`
        select channel, status from public.notification_log
         where appointment_id = ${appt.id} and type = ${logType}`;
      const toSend = channelsToSend(planned, log);

      const results: SendResult[] = [];
      for (const channel of toSend) {
        const to = channel === 'email' ? appt.client_email! : phone!;
        // Reserve the log row before sending (see header): no duplicate if anything fails after.
        const [reserved] = await sql<{ id: string }[]>`
          insert into public.notification_log
                 (business_id, appointment_id, channel, type, to_masked, status)
          values (${appt.business_id}, ${appt.id}, ${channel}, ${logType}, ${maskRecipient(to)}, 'sending')
          returning id`;
        const r =
          channel === 'email'
            ? await sendEmail(to, copy.subject, copy.text)
            : await sendWhatsApp(to, copy.text, copy.wa ? { template: copy.wa } : undefined);
        results.push(r);
        const f = notificationLogResult(to, r);
        await sql`update public.notification_log
                     set status = ${f.status}, template = ${f.template}, wamid = ${f.wamid},
                         error_code = ${f.error_code}, error_message = ${f.error_message},
                         updated_at = now()
                   where id = ${reserved.id}`;
      }

      // Best-effort client push, once (first attempt only); does not fail the reminder.
      if (appt.client_user_id && isFirstAttempt(log)) {
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

      const failedNow = failedChannels(results);
      const retry = shouldRetry(failedNow, log);
      if (retry) await release(appt.id);

      outcomes.push({
        id: appt.id,
        ok: failedNow.length === 0,
        kind: soon ?? opts.kind,
        ...(failedNow.length
          ? { detail: `failed:${failedNow.join(',')}${retry ? ' retry_scheduled' : ' gave_up'}` }
          : soonWhatsappReady
            ? {}
            : { detail: 'whatsapp_skipped_no_1h_template' }),
      });
    } catch (e) {
      // Unexpected error (DB, provider exception): release so the next run retries; channels
      // already logged as sent are skipped then, so nothing is sent twice.
      await release(appt.id).catch((relErr) => console.error('reminder release failed', appt.id, relErr));
      outcomes.push({
        id: appt.id,
        ok: false,
        kind: soon ?? opts.kind,
        detail: `${e instanceof Error ? e.message : String(e)} retry_scheduled`,
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

  // admin is still used by the shared push helper (push tokens).
  const admin = createClient(supabaseUrl, serviceKey);
  const sql = postgres(dbUrl, { max: 1, prepare: false });
  const now = Date.now();

  const windowSoon = soonWindow(now);
  const window24h = {
    from: new Date(now + 23.5 * 60 * 60 * 1000).toISOString(),
    to: new Date(now + 24.5 * 60 * 60 * 1000).toISOString(),
  };

  try {
    const [outcomes24h, outcomesSoon] = await Promise.all([
      processWindow(sql, admin, {
        from: window24h.from,
        to: window24h.to,
        flag: 'reminder_24h_sent',
        kind: '24h',
        nowMs: now,
      }),
      processWindow(sql, admin, {
        from: windowSoon.from,
        to: windowSoon.to,
        confirmedBefore: windowSoon.confirmedBefore,
        flag: 'reminder_sent',
        kind: 'soon',
        nowMs: now,
      }),
    ]);

    const outcomes = [...outcomes24h, ...outcomesSoon];
    return jsonResponse({
      ok: true,
      window_24h: window24h,
      window_soon: windowSoon,
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
