import { functionErrorCode } from './notify-client';
import { supabase } from './supabase';
import { getPublicWebOrigin } from './webBase';
import { isBusinessRole, type BusinessRole } from './teamAccess';

export type { BusinessRole };

export type BusinessMember = {
  member_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: BusinessRole;
  staff_id: string | null;
  staff_name: string | null;
  created_at: string;
};

export type BusinessInvitation = {
  id: string;
  business_id: string;
  email: string;
  role: BusinessRole;
  staff_id: string | null;
  token: string;
  expires_at: string;
  created_at: string;
  last_sent_at: string | null;
};

export type MyBusinessInvitation = {
  invitation_id: string;
  business_id: string;
  business_name: string;
  role: BusinessRole;
  staff_id: string | null;
  token: string;
  expires_at: string;
  staff_name: string | null;
};

/** Invitația deschisă din linkul /invitatie?token=… (v97: get_business_invitation). */
export type InvitationByToken = {
  invitation_id: string;
  business_id: string;
  business_name: string;
  role: BusinessRole;
  staff_name: string | null;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  email_matches: boolean;
};

/** Rolul meu într-un business; proprietarul istoric fără rând de membru rămâne 'owner' (rezolvat în SQL). */
export async function fetchBusinessRole(businessId: string): Promise<BusinessRole | null> {
  const { data, error } = await supabase.rpc('business_member_role', { p_business_id: businessId });
  if (error || !isBusinessRole(data)) return null;
  return data;
}

/** Id-urile business-urilor în care sunt membru (orice rol), pentru accesul angajaților. */
export async function fetchMemberBusinessIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('business_members')
    .select('business_id')
    .eq('user_id', userId);
  if (error) return [];
  return (data ?? []).map((r) => r.business_id as string);
}

export async function fetchBusinessMembers(businessId: string) {
  const { data, error } = await supabase.rpc('list_business_members', { p_business_id: businessId });
  return { members: (data ?? []) as BusinessMember[], error: error?.message ?? null };
}

export async function fetchBusinessInvitations(businessId: string) {
  const { data, error } = await supabase.rpc('list_business_invitations', { p_business_id: businessId });
  return { invitations: (data ?? []) as BusinessInvitation[], error: error?.message ?? null };
}

export async function inviteBusinessMember(opts: {
  businessId: string;
  email: string;
  role: BusinessRole;
  staffId: string | null;
}) {
  const { data, error } = await supabase.rpc('invite_business_member', {
    p_business_id: opts.businessId,
    p_email: opts.email,
    p_role: opts.role,
    p_staff_id: opts.staffId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return { invitation: (row ?? null) as BusinessInvitation | null, error: error?.message ?? null };
}

export async function fetchMyBusinessInvitations() {
  const { data, error } = await supabase.rpc('list_my_business_invitations');
  return { invitations: (data ?? []) as MyBusinessInvitation[], error: error?.message ?? null };
}

export async function fetchInvitationByToken(token: string) {
  const { data, error } = await supabase.rpc('get_business_invitation', { p_token: token.trim() });
  const row = Array.isArray(data) ? data[0] : data;
  return { invitation: (row ?? null) as InvitationByToken | null, error: error?.message ?? null };
}

/** Acceptă invitația; întoarce business-ul în care tocmai am intrat. */
export async function acceptBusinessInvitation(token: string) {
  const { data, error } = await supabase.rpc('accept_business_invitation', { p_token: token.trim() });
  const row = (Array.isArray(data) ? data[0] : data) as { business_id?: string } | null;
  return { businessId: row?.business_id ?? null, error: error?.message ?? null };
}

/** Emailul de invitație (Brevo) prin send-business-invite; serverul limitează la 1 / minut. */
export async function sendBusinessInviteEmail(invitationId: string): Promise<{ error: string | null }> {
  const { data, error } = await supabase.functions.invoke('send-business-invite', {
    body: { invitation_id: invitationId },
  });
  if (error) return { error: (await functionErrorCode(error)) ?? error.message };
  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload?.ok === false) return { error: payload.error ?? 'email_failed' };
  return { error: null };
}

/** Linkul public de acceptare, același ca în email. */
export function invitationLink(token: string): string {
  return `${getPublicWebOrigin()}/invitatie?token=${encodeURIComponent(token)}`;
}

export async function updateBusinessMemberRole(memberId: string, role: BusinessRole) {
  const { error } = await supabase.rpc('update_business_member_role', {
    p_member_id: memberId,
    p_role: role,
  });
  return { error: error?.message ?? null };
}

export async function removeBusinessMember(memberId: string) {
  const { error } = await supabase.rpc('remove_business_member', { p_member_id: memberId });
  return { error: error?.message ?? null };
}

export async function revokeBusinessInvitation(invitationId: string) {
  const { error } = await supabase.rpc('revoke_business_invitation', {
    p_invitation_id: invitationId,
  });
  return { error: error?.message ?? null };
}
