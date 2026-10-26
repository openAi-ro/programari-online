/**
 * Booking requests (status pending) hold their slot until the salon answers. Unanswered ones
 * expire at public.pending_request_deadline (2h before the start; at least 30 min after the
 * request, at the latest at the start). public.expire_pending_requests() cancels them
 * atomically with cancel_reason 'request_expired'; the client and the owner are told here.
 * The pg_cron gate of the send-reminders job also wakes this function for such rows (v88).
 */
import {
  appWebBase,
  messagePendingExpired,
  messagePendingExpiredOwner,
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
};

export type PendingExpiryOutcome = { id: string; notified: boolean; error?: string };

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

export async function expirePendingRequests(sql: Sql, admin: Admin): Promise<PendingExpiryOutcome[]> {
  const rows: ExpiredRow[] = await sql`select * from public.expire_pending_requests()`;
  const outcomes: PendingExpiryOutcome[] = [];
  for (const row of rows) {
    try {
      const [ctx] = await sql<
        {
          name: string | null;
          public_code: string | null;
          timezone: string | null;
          owner_user_id: string | null;
          owner_language: string | null;
          language: string | null;
          notify_decision: boolean | null;
          notify_whatsapp: boolean | null;
        }[]
      >`select b.name, b.public_code, b.timezone, b.owner_user_id, o.language as owner_language,
               p.language, p.notify_decision, p.notify_whatsapp
          from public.business_profiles b
          left join public.profiles o on o.id = b.owner_user_id
          left join public.profiles p on p.id = ${row.r_client_user_id}
         where b.id = ${row.r_business_id}`;
      const tz = ctx?.timezone ?? 'Europe/Bucharest';
      const startIso = new Date(row.r_start_at).toISOString();
      let notified = false;
      if (ctx?.notify_decision !== false) {
        const lang = parseNotifyLang(ctx?.language ?? undefined);
        const link = ctx?.public_code ? `${appWebBase()}/b/${ctx.public_code}` : appWebBase();
        const msg = messagePendingExpired(ctx?.name ?? 'business', formatWhen(startIso, tz, lang), link, lang);
        await notifyClientChannels({
          email: row.r_client_email,
          phone: ctx?.notify_whatsapp === false
            ? null
            : await resolveClientPhone(admin, row.r_client_phone, row.r_client_user_id),
          subject: msg.subject,
          text: msg.text,
          log: { admin, type: 'PENDING_EXPIRED', businessId: row.r_business_id, appointmentId: row.r_id },
        });
        if (row.r_client_user_id) {
          await sendExpoPushToUser(admin, row.r_client_user_id, {
            title: msg.subject,
            body: msg.text,
            channelId: 'cereri_heads',
            data: { screen: 'my-appointments', appointmentId: row.r_id },
          });
        }
        notified = true;
      }
      if (ctx?.owner_user_id) {
        const ownerLang = parseNotifyLang(ctx.owner_language ?? undefined);
        const contact = row.r_client_email || row.r_client_phone || '-';
        const ownerMsg = messagePendingExpiredOwner(contact, formatWhen(startIso, tz, ownerLang), ownerLang);
        await sendExpoPushToUser(admin, ctx.owner_user_id, {
          title: ownerMsg.subject,
          body: ownerMsg.text,
          channelId: 'cereri_heads',
          data: { screen: 'requests', appointmentId: row.r_id, businessId: row.r_business_id },
        });
      }
      outcomes.push({ id: row.r_id, notified });
    } catch (e) {
      console.error('pending expiry notify failed', row.r_id, e);
      outcomes.push({ id: row.r_id, notified: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return outcomes;
}
