/**
 * Edge Function: send-reminders
 *
 * Cron every 1–5 minutes:
 * 1) 24h before: approved, reminder_24h_sent=false, start_at in now+23.5h … now+24.5h
 * 2) 30min before: approved, reminder_sent=false, start_at in now+25m .. now+35m.
 *
 * Invoke with service role (cron / scheduled function).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  messageReminder,
  messageReminder24h,
  notifyClientChannels,
} from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type Admin = ReturnType<typeof createClient>;

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

async function processWindow(
  admin: Admin,
  opts: {
    from: string;
    to: string;
    flag: 'reminder_sent' | 'reminder_24h_sent';
    kind: '30min' | '24h';
  }
): Promise<{ id: string; ok: boolean; detail?: string; kind: string }[]> {
  const { data: rows, error } = await admin
    .from('appointments')
    .select(
      'id, business_id, client_user_id, client_email, client_phone, start_at, status, reminder_sent, reminder_24h_sent'
    )
    .eq('status', 'approved')
    .eq(opts.flag, false)
    .gte('start_at', opts.from)
    .lte('start_at', opts.to);

  if (error) {
    throw new Error(error.message);
  }

  const list = rows ?? [];
  const outcomes: { id: string; ok: boolean; detail?: string; kind: string }[] = [];

  const clientIds = [
    ...new Set(list.map((r) => r.client_user_id).filter((v): v is string => !!v)),
  ];
  const notifyByUser: Record<string, boolean> = {};
  const whatsappByUser: Record<string, boolean> = {};
  if (clientIds.length) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, notify_reminders, notify_whatsapp, language')
      .in('id', clientIds);
    for (const p of profiles ?? []) {
      notifyByUser[p.id as string] = p.notify_reminders !== false;
      whatsappByUser[p.id as string] = p.notify_whatsapp !== false;
    }
  }

  for (const appt of list) {
    const wantsReminder =
      !appt.client_user_id || notifyByUser[appt.client_user_id] !== false;

    if (!wantsReminder) {
      await admin
        .from('appointments')
        .update({
          [opts.flag]: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appt.id)
        .eq(opts.flag, false);
      outcomes.push({ id: appt.id, ok: true, kind: opts.kind, detail: 'opted_out' });
      continue;
    }

    const { data: business } = await admin
      .from('business_profiles')
      .select('name, timezone')
      .eq('id', appt.business_id)
      .maybeSingle();

    const businessName = business?.name ?? 'business';
    const timezone = business?.timezone ?? 'Europe/Bucharest';
    const lang: 'ro' | 'en' = appt.client_user_id ? (langByUser[appt.client_user_id] ?? 'ro') : 'ro';
    const copy =
      opts.kind === '24h'
        ? messageReminder24h(businessName, timeLocal, timezone, lang)
        : messageReminder(businessName, timeLocal, timezone, lang);

    try {
      const wantsWhatsapp =
        !appt.client_user_id || whatsappByUser[appt.client_user_id] !== false;
      await notifyClientChannels({
        email: appt.client_email,
        phone: wantsWhatsapp ? appt.client_phone : null,
        subject: copy.subject,
        text: copy.text,
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

      const { error: updErr } = await admin
        .from('appointments')
        .update({
          [opts.flag]: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appt.id)
        .eq(opts.flag, false);

      if (updErr) {
        outcomes.push({ id: appt.id, ok: false, detail: updErr.message, kind: opts.kind });
      } else {
        outcomes.push({ id: appt.id, ok: true, kind: opts.kind });
      }
    } catch (e) {
      await admin
        .from('appointments')
        .update({
          [opts.flag]: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appt.id)
        .eq(opts.flag, false);
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

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    const headerSecret = req.headers.get('x-cron-secret');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (headerSecret !== cronSecret && bearer !== cronSecret) {
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!serviceKey || bearer !== serviceKey) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
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
      processWindow(admin, {
        from: window24h.from,
        to: window24h.to,
        flag: 'reminder_24h_sent',
        kind: '24h',
      }),
      processWindow(admin, {
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
  }
});
