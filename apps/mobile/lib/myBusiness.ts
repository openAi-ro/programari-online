import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { fetchMemberBusinessIds } from './businessMembers';
import type { BusinessProfile } from './types';

const KEY = 'programari.selectedBusinessId';

/** Business ales explicit de owner (multi-business); implicit primul. */
export async function getSelectedBusinessId(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export async function setSelectedBusinessId(id: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, id);
  } catch {
    // best-effort: fara persistenta ramane primul business
  }
}

export async function listMyBusinesses(ownerUserId: string): Promise<BusinessProfile[]> {
  const { data } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('owner_user_id', ownerUserId)
    .order('created_at', { ascending: true });
  const owned = (data ?? []) as BusinessProfile[];
  // v89: angajatii (business_members) vad business-urile la care sunt membri, nu doar pe cele detinute.
  const memberIds = await fetchMemberBusinessIds(ownerUserId);
  const extraIds = memberIds.filter((id) => !owned.some((b) => b.id === id));
  if (extraIds.length === 0) return owned;
  const { data: memberBiz } = await supabase
    .from('business_profiles')
    .select('*')
    .in('id', extraIds)
    .order('created_at', { ascending: true });
  return [...owned, ...((memberBiz ?? []) as BusinessProfile[])];
}

/**
 * Business-ul activ al ownerului: cel selectat (daca inca ii apartine),
 * altfel primul. Inlocuieste pattern-ul .maybeSingle() pe owner_user_id,
 * care alegea arbitrar cand exista mai multe business-uri.
 */
export async function fetchMyBusiness(ownerUserId: string): Promise<BusinessProfile | null> {
  const rows = await listMyBusinesses(ownerUserId);
  if (rows.length === 0) return null;
  const selectedId = await getSelectedBusinessId();
  return rows.find((b) => b.id === selectedId) ?? rows[0];
}

/** Aceeasi forma ca un query Supabase, pentru inlocuirea .maybeSingle() pe owner. */
export async function fetchMyBusinessResult(
  ownerUserId: string
): Promise<{ data: BusinessProfile | null; error: { message: string } | null }> {
  return { data: await fetchMyBusiness(ownerUserId), error: null };
}

export async function fetchMyBusinessId(ownerUserId: string): Promise<string | null> {
  const business = await fetchMyBusiness(ownerUserId);
  return business?.id ?? null;
}
