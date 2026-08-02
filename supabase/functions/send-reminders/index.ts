/**
 * Edge Function: send-reminders
 *
 * Cron every 1–5 minutes:
 * Select approved appointments with reminder_sent=false and
 * start_at between now+25m and now+35m; notify client; set reminder_sent.
 *
 * Invoke with service role (cron / scheduled function).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { messageReminder, notifyClientChannels } from '../_shared/notify.ts';

function formatTimeLocal(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('ro-RO', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  // Allow GET for simple cron pings
  if (req.method !== 'POST' && req.method !== 'GET') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    const headerSecret = req.headers.get('x-cron-secret');
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (headerSecret !== cronSecret && bearer !== cronSecret) {
      // Also accept service role as auth when CRON_SECRET not matched
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
  const from = new Date(now + 25 * 60 * 1000).toISOString();
  const to = new Date(now + 35 * 60 * 1000).toISOString();

  const { data: rows, error } = await admin
    .from('appointments')
    .select(
      'id, business_id, client_email, client_phone, start_at, status, reminder_sent'
    )
    .eq('status', 'approved')
    .eq('reminder_sent', false)
    .gte('start_at', from)
    .lte('start_at', to);

  if (error) {
    console.error('select reminders failed', error);
    return jsonResponse({ error: error.message }, 500);
  }

  const list = rows ?? [];
  const outcomes: { id: string; ok: boolean; detail?: string }[] = [];

  for (const appt of list) {
    const { data: business } = await admin
      .from('business_profiles')
      .select('name, timezone')
      .eq('id', appt.business_id)
      .maybeSingle();

    const businessName = business?.name ?? 'business';
    const timezone = business?.timezone ?? 'Europe/Bucharest';
    const timeLocal = formatTimeLocal(appt.start_at, timezone);
    const copy = messageReminder(businessName, timeLocal, timezone);

    try {
      await notifyClientChannels({
        email: appt.client_email,
        phone: appt.client_phone,
        subject: copy.subject,
        text: copy.text,
      });

      const { error: updErr } = await admin
        .from('appointments')
        .update({
          reminder_sent: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appt.id)
        .eq('reminder_sent', false);

      if (updErr) {
        outcomes.push({ id: appt.id, ok: false, detail: updErr.message });
      } else {
        outcomes.push({ id: appt.id, ok: true });
      }
    } catch (e) {
      // Still mark sent after attempt to avoid infinite retries (MVP)
      await admin
        .from('appointments')
        .update({
          reminder_sent: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', appt.id)
        .eq('reminder_sent', false);
      outcomes.push({
        id: appt.id,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return jsonResponse({
    ok: true,
    window: { from, to },
    processed: list.length,
    outcomes,
  });
});
