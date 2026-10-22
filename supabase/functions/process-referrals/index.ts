/**
 * Edge Function: process-referrals
 *
 * Cron zilnic: invitatul are prima vizita aprobata la o firma cu recomandari
 * active -> referral rewarded + push catre cel care a invitat.
 * Invoke with service role (cron / scheduled function).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { authorizeCron } from '../_shared/secret-auth.ts';
import { sendExpoPushToUser } from '../_shared/expoPush.ts';

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
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: pending } = await admin
    .from('referrals')
    .select('id, referrer_user_id, referred_user_id')
    .eq('status', 'pending')
    .limit(200);

  const outcomes: { id: string; ok: boolean; detail?: string }[] = [];
  for (const ref of pending ?? []) {
    const { data: visit } = await admin
      .from('appointments')
      .select('id, business_id')
      .eq('client_user_id', ref.referred_user_id)
      .eq('status', 'approved')
      .order('start_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!visit) continue;

    const { data: business } = await admin
      .from('business_profiles')
      .select('name, referral_enabled, referral_reward_text')
      .eq('id', visit.business_id)
      .maybeSingle();

    if (!business || business.referral_enabled !== true) continue;

    const { error: updErr } = await admin
      .from('referrals')
      .update({ status: 'rewarded', rewarded_at: new Date().toISOString() })
      .eq('id', ref.id)
      .eq('status', 'pending');

    if (updErr) {
      outcomes.push({ id: ref.id, ok: false, detail: updErr.message });
      continue;
    }

    const reward = business.referral_reward_text || '';
    try {
      await sendExpoPushToUser(admin, ref.referrer_user_id, {
        title: 'Ai primit o recompensă!',
        body: reward
          ? `Prietenul invitat a fost la ${business.name}. Recompensa ta: ${reward}.`
          : `Prietenul invitat a fost la ${business.name}. Cere recompensa la salon!`,
        channelId: 'cereri_heads',
        data: { screen: 'my-appointments' },
      });
    } catch (pushErr) {
      console.error('referral push failed', ref.id, pushErr);
    }
    outcomes.push({ id: ref.id, ok: true });
  }

  return jsonResponse({ ok: true, processed: outcomes.length, outcomes });
});
