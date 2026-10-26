import { supabase } from './supabase';
import { isBusinessRole, type BusinessRole } from './teamAccess';
import type { WalkinClientCandidate } from './walkinClientSearch';

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
};

export type MyBusinessInvitation = {
  invitation_id: string;
  business_id: string;
  business_name: string;
  role: BusinessRole;
  staff_id: string | null;
  token: string;
  expires_at: string;
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

export async function acceptBusinessInvitation(token: string) {
  const { error } = await supabase.rpc('accept_business_invitation', { p_token: token.trim() });
  return { error: error?.message ?? null };
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

/** Clienți existenți pentru walk-in; pe server, staff vede doar clienții specialistului propriu. */
export async function searchBusinessClients(
  businessId: string,
  query: string,
): Promise<{ clients: WalkinClientCandidate[]; error: string | null }> {
  const { data, error } = await supabase.rpc('search_business_clients', {
    p_business_id: businessId,
    p_query: query,
  });
  if (error) return { clients: [], error: error.message };
  const clients = (data ?? []).map((r: Record<string, unknown>) => ({
    clientUserId: String(r.client_user_id),
    displayName: (r.display_name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    visitCount: Number(r.visit_count ?? 0),
  }));
  return { clients, error: null };
}
