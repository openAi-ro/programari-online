/**
 * Verify caller may trigger decision notification:
 * - webhook secret header, OR
 * - service role bearer, OR
 * - authenticated user who owns the business for this appointment
 *   (or, with opts.allowAdmin, an admin member of that business).
 */
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { bearerToken, checkWebhookSecret, isServiceRole } from './secret-auth.ts';

export async function authorizeNotifyRequest(
  req: Request,
  admin: SupabaseClient,
  appointmentId: string | undefined,
  opts: { allowAdmin?: boolean } = {}
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const webhook = checkWebhookSecret(req);
  if (webhook === 'missing') return { ok: false, status: 500, error: 'server_misconfigured' };
  if (webhook === 'ok') return { ok: true };

  const auth = req.headers.get('authorization') ?? '';
  const bearer = bearerToken(req);

  if (isServiceRole(req)) return { ok: true };

  if (!appointmentId || !bearer) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) {
    return { ok: false, status: 500, error: 'server_misconfigured' };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();

  if (userErr || !user) {
    return { ok: false, status: 401, error: 'unauthorized' };
  }

  const { data: appt } = await admin
    .from('appointments')
    .select('business_id')
    .eq('id', appointmentId)
    .maybeSingle();

  if (!appt?.business_id) {
    return { ok: false, status: 404, error: 'appointment_not_found' };
  }

  const { data: business } = await admin
    .from('business_profiles')
    .select('owner_user_id')
    .eq('id', appt.business_id)
    .maybeSingle();

  if (business?.owner_user_id === user.id) return { ok: true };

  if (opts.allowAdmin) {
    const { data: member } = await admin
      .from('business_members')
      .select('role')
      .eq('business_id', appt.business_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (member?.role === 'admin') return { ok: true };
  }

  return { ok: false, status: 403, error: 'forbidden' };
}
