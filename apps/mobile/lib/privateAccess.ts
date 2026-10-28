import { supabase } from '@/lib/supabase';

import { normalizeAccessCode } from './accessCode';

/**
 * Business privat („Top secret”, v99/v100): coduri de invitație + acces clienți.
 * Toate operațiile trec prin RPC-uri security definer; codul în clar există doar
 * în răspunsul de la creare (DB păstrează doar hash-ul).
 */

export type RedeemResult =
  | { ok: true; publicCode: string; name: string }
  | { ok: false; error: 'auth_required' | 'locked' | 'invalid' };

export async function redeemAccessCode(raw: string): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_business_access_code', {
    p_code: normalizeAccessCode(raw),
  });
  const d = (data ?? {}) as { ok?: boolean; public_code?: string; name?: string; error?: string };
  if (error || !d.ok || !d.public_code) {
    const e = d.error === 'auth_required' || d.error === 'locked' ? d.error : 'invalid';
    return { ok: false, error: e };
  }
  return { ok: true, publicCode: d.public_code, name: d.name ?? '' };
}

export type AccessCodeStatus = 'active' | 'used' | 'expired' | 'revoked';

export type AccessCodeRow = {
  id: string;
  label: string | null;
  code_hint: string;
  max_uses: number;
  used_count: number;
  expires_at: string;
  created_at: string;
  status: AccessCodeStatus;
};

export type AccessClientRow = {
  user_id: string;
  display_name: string | null;
  email: string | null;
  granted_at: string;
};

export type CreatedAccessCode = { id: string; code: string; expires_at: string; max_uses: number };

export async function createAccessCode(opts: {
  businessId: string;
  expiresAt: Date;
  maxUses: number;
  label?: string;
}): Promise<{ created: CreatedAccessCode | null; error: string | null }> {
  const { data, error } = await supabase.rpc('create_business_access_code', {
    p_business_id: opts.businessId,
    p_expires_at: opts.expiresAt.toISOString(),
    p_max_uses: opts.maxUses,
    p_label: opts.label?.trim() || null,
  });
  const row = Array.isArray(data) ? (data[0] as CreatedAccessCode | undefined) : undefined;
  if (error || !row) return { created: null, error: error?.message ?? 'unknown' };
  return { created: row, error: null };
}

export async function listAccessCodes(
  businessId: string
): Promise<{ rows: AccessCodeRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('list_business_access_codes', { p_business_id: businessId });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AccessCodeRow[], error: null };
}

export async function revokeAccessCode(codeId: string): Promise<string | null> {
  const { error } = await supabase.rpc('revoke_business_access_code', { p_code_id: codeId });
  return error?.message ?? null;
}

export async function listAccessClients(
  businessId: string
): Promise<{ rows: AccessClientRow[]; error: string | null }> {
  const { data, error } = await supabase.rpc('list_business_access_clients', { p_business_id: businessId });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AccessClientRow[], error: null };
}

export async function revokeClientAccess(businessId: string, userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('revoke_business_client_access', {
    p_business_id: businessId,
    p_user_id: userId,
  });
  return error?.message ?? null;
}

/** Poarta (gratuit acum; planul plătit va schimba doar funcția din DB). */
export async function canUsePrivateMode(businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_use_private_mode', { p_business_id: businessId });
  return !error && data === true;
}

export async function setBusinessPrivate(businessId: string, value: boolean): Promise<string | null> {
  const { error } = await supabase.from('business_profiles').update({ is_private: value }).eq('id', businessId);
  return error?.message ?? null;
}
