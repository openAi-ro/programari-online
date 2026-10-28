/**
 * Edge Function: send-business-invite
 *
 * Body: { invitation_id, lang? }
 * Auth: JWT of an owner/admin of the invitation's business (checked by
 * claim_business_invitation_send, which also enforces 1 send / minute / invitation).
 *
 * Emails the invitee (Brevo) with the salon name, the role and a link to
 * <web>/invitatie?token=…; the code stays usable in the app as a fallback.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import {
  appWebBase,
  logNotification,
  messageBusinessInvite,
  parseNotifyLang,
  sendEmail,
} from '../_shared/notify.ts';

type Claim = {
  email: string;
  role: 'staff' | 'admin';
  token: string;
  expires_at: string;
  business_name: string;
  staff_name: string | null;
  invited_by_name: string | null;
};

const KNOWN_ERRORS = ['not_authenticated', 'invitation_not_found', 'not_allowed', 'resend_too_soon'];

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  let payload: { invitation_id?: string; lang?: string };
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }
  const invitationId = (payload.invitation_id ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(invitationId)) return jsonResponse({ error: 'invalid_payload' }, 400);
  const lang = parseNotifyLang(payload.lang);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) return jsonResponse({ error: 'server_misconfigured' }, 500);

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResponse({ error: 'unauthorized' }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await userClient.rpc('claim_business_invitation_send', {
    p_invitation_id: invitationId,
  });
  if (error) {
    const code = KNOWN_ERRORS.find((k) => error.message.includes(k)) ?? 'claim_failed';
    const status = code === 'resend_too_soon' ? 429 : code === 'not_allowed' ? 403 : 400;
    return jsonResponse({ ok: false, error: code }, status);
  }
  const claim = (Array.isArray(data) ? data[0] : data) as Claim | undefined;
  if (!claim) return jsonResponse({ ok: false, error: 'invitation_not_found' }, 404);

  const link = `${appWebBase()}/invitatie?token=${encodeURIComponent(claim.token)}`;
  const msg = messageBusinessInvite(
    {
      businessName: claim.business_name,
      inviterName: claim.invited_by_name || claim.business_name,
      role: claim.role,
      staffName: claim.staff_name,
      email: claim.email,
      link,
      token: claim.token,
      expiresAt: claim.expires_at,
    },
    lang
  );
  const result = await sendEmail(claim.email, msg.subject, msg.text);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: inv } = await admin
    .from('business_invitations')
    .select('business_id')
    .eq('id', invitationId)
    .maybeSingle();
  await logNotification(
    { admin, type: 'business_invite', businessId: (inv as { business_id?: string } | null)?.business_id ?? null },
    claim.email,
    result
  );

  if (!result.ok) {
    // Trimiterea nu a plecat: nu consuma limita de 1 / minut.
    await admin
      .from('business_invitations')
      .update({ last_sent_at: null })
      .eq('id', invitationId);
    return jsonResponse({ ok: false, error: result.stub ? 'email_not_configured' : 'email_failed' }, 502);
  }
  return jsonResponse({ ok: true, expires_at: claim.expires_at });
});
