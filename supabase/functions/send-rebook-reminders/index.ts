/**
 * Edge Function: send-rebook-reminders
 *
 * Cron zilnic: clientul a depasit ritmul serviciului (rebook_interval_days)
 * si n-are programare viitoare -> reminder pe canalele lui (email/WhatsApp + push).
 * Invoke with service role (cron / scheduled function).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { messageRebook, notifyClientChannels } from '../_shared/notify.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

type Admin = ReturnType<typeof createClient>;

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
  const outcomes: { id: string; ok: boolean; detail?: string }[] = [];

  const { data: services, error: svcErr } = await admin
    .from('services')
    .select('id, business_id, name, rebook_interval_days')
    .gt('rebook_interval_days', 0)
    .eq('active', true)
    .limit(200);
  if (svcErr) return jsonResponse({ error: svcErr.message }, 500);

  for (const svc of services ?? []) {
    const interval = svc.rebook_interval_days as number;
    const cutoff = new Date(now - interval * 86_400_000).toISOString();

    // Ultima vizita aprobata per client pentru acest serviciu, mai veche decat ritmul.
    const { data: visits } = await admin
      .from('appointments')
      .select('id, business_id, client_user_id, client_email, client_phone, start_at, service_name')
      .eq('business_id', svc.business_id)
      .eq('service_id', svc.id)
      .eq('status', 'approved')
      .eq('rebook_reminded', false)
      .lt('start_at', cutoff)
      .order('start_at', { ascending: false })
      .limit(200);

    if (!visits || visits.length === 0) continue;

    const byClient = new Map<string, (typeof visits)[number]>();
    for (const v of visits) {
      if (v.client_user_id && !byClient.has(v.client_user_id)) {
        byClient.set(v.client_user_id, v);
      }
    }

    const { data: upcoming } = await admin
      .from('appointments')
      .select('client_user_id')
      .eq('business_id', svc.business_id)
      .eq('status', 'approved')
      .gte('start_at', new Date(now).toISOString())
      .limit(500);
    const hasUpcoming = new Set((upcoming ?? []).map((u) => u.client_user_id));

    const { data: business } = await admin
      .from('business_profiles')
      .select('name')
      .eq('id', svc.business_id)
      .maybeSingle();

    for (const visit of byClient.values()) {
      if (hasUpcoming.has(visit.client_user_id)) {
        await admin.from('appointments').update({ rebook_reminded: true }).eq('id', visit.id);
        continue;
      }
      let lang: 'ro' | 'en' = 'ro';
      let whatsappOk = true;
      let profilePhone: string | null = null;
      if (visit.client_user_id) {
        const { data: profile } = await admin
          .from('profiles')
          .select('language, notify_reminders, notify_whatsapp, phone')
          .eq('id', visit.client_user_id)
          .maybeSingle();
        lang = profile?.language === 'en' ? 'en' : 'ro';
        if (profile && profile.notify_reminders === false) {
          await admin.from('appointments').update({ rebook_reminded: true }).eq('id', visit.id);
          outcomes.push({ id: visit.id, ok: true, detail: 'opted_out' });
          continue;
        }
        whatsappOk = profile ? profile.notify_whatsapp !== false : true;
        profilePhone = (profile?.phone as string | null | undefined) ?? null;
      }
      const copy = messageRebook(business?.name ?? 'business', svc.name, lang);
      try {
        await notifyClientChannels({
          email: visit.client_email,
          phone: whatsappOk
            ? visit.client_phone && `${visit.client_phone}`.trim()
              ? visit.client_phone
              : profilePhone
            : null,
          subject: copy.subject,
          text: copy.text,
          wa: copy.wa,
          log: { admin, type: 'REBOOK', businessId: visit.business_id, appointmentId: visit.id },
        });
        if (visit.client_user_id) {
          try {
            await sendExpoPushToUser(admin, visit.client_user_id, {
              title: copy.subject,
              body: copy.text,
              channelId: 'cereri_heads',
              data: { screen: 'my-appointments' },
            });
          } catch (pushErr) {
            console.error('rebook push failed', visit.id, pushErr);
          }
        }
        await admin.from('appointments').update({ rebook_reminded: true }).eq('id', visit.id);
        outcomes.push({ id: visit.id, ok: true });
      } catch (e) {
        await admin.from('appointments').update({ rebook_reminded: true }).eq('id', visit.id);
        outcomes.push({ id: visit.id, ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return jsonResponse({ ok: true, processed: outcomes.length, outcomes });
});
