/**
 * Reschedule requests (v87) that nobody answered expire 2h before the earlier of the
 * original and the requested start. public.expire_reschedule_requests() clears them
 * atomically (also requests left on cancelled/completed rows) and returns the rows; the
 * client is told the original time stays (r_notify_client = still an active booking).
 * The pg_cron gate of the send-reminders job also wakes this function for such rows.
 */
import {
  messageRescheduleExpired,
  notifyClientChannels,
  notifyLocale,
  parseNotifyLang,
  resolveClientPhone,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;
// deno-lint-ignore no-explicit-any
type Sql = any;

type ExpiredRow = {
  r_id: string;
  r_business_id: string;
  r_client_user_id: string | null;
  r_client_email: string | null;
  r_client_phone: string | null;
  r_start_at: string | Date;
  r_requested_start_at: string | Date;
  r_notify_client: boolean;
};

export type ExpiryOutcome = { id: string; notified: boolean; error?: string };

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

export async function expireRescheduleRequests(sql: Sql, admin: Admin): Promise<ExpiryOutcome[]> {
  const rows: ExpiredRow[] = await sql`select * from public.expire_reschedule_requests()`;
  const outcomes: ExpiryOutcome[] = [];
  for (const row of rows) {
    if (!row.r_notify_client) {
      outcomes.push({ id: row.r_id, notified: false });
      continue;
    }
    try {
      const [ctx] = await sql<
        { name: string | null; timezone: string | null; language: string | null; notify_decision: boolean | null; notify_whatsapp: boolean | null }[]
      >`select b.name, b.timezone, p.language, p.notify_decision, p.notify_whatsapp
          from public.business_profiles b
          left join public.profiles p on p.id = ${row.r_client_user_id}
         where b.id = ${row.r_business_id}`;
      if (ctx?.notify_decision === false) {
        outcomes.push({ id: row.r_id, notified: false });
        continue;
      }
      const lang = parseNotifyLang(ctx?.language ?? undefined);
      const startIso = new Date(row.r_start_at).toISOString();
      const msg = messageRescheduleExpired(
        ctx?.name ?? 'business',
        formatWhen(startIso, ctx?.timezone ?? 'Europe/Bucharest', lang),
        lang
      );
      await notifyClientChannels({
        email: row.r_client_email,
        phone: ctx?.notify_whatsapp === false
          ? null
          : await resolveClientPhone(admin, row.r_client_phone, row.r_client_user_id),
        subject: msg.subject,
        text: msg.text,
        log: { admin, type: 'RESCHEDULE_EXPIRED', businessId: row.r_business_id, appointmentId: row.r_id },
      });
      if (row.r_client_user_id) {
        await sendExpoPushToUser(admin, row.r_client_user_id, {
          title: msg.subject,
          body: msg.text,
          channelId: 'cereri_heads',
          data: { screen: 'my-appointments', appointmentId: row.r_id },
        });
      }
      outcomes.push({ id: row.r_id, notified: true });
    } catch (e) {
      console.error('reschedule expiry notify failed', row.r_id, e);
      outcomes.push({ id: row.r_id, notified: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}
