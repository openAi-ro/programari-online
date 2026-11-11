import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';
import { fetchMemberBusinessIdsResult } from './businessMembers';
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
  return (await listMyBusinessesResult(ownerUserId)).rows;
}

/** Business-urile proprii și din echipă, cu prima eroare de citire (nu „niciun business”). */
async function listMyBusinessesResult(
  ownerUserId: string
): Promise<{ rows: BusinessProfile[]; error: { message: string } | null }> {
  const { data, error } = await supabase
    .from('business_profiles')
    .select('*')
    .eq('owner_user_id', ownerUserId)
    .order('created_at', { ascending: true });
  if (error) return { rows: [], error };
  const owned = (data ?? []) as BusinessProfile[];
  // v89: angajatii (business_members) vad business-urile la care sunt membri, nu doar pe cele detinute.
  const member = await fetchMemberBusinessIdsResult(ownerUserId);
  if (member.error) return { rows: owned, error: member.error };
  const extraIds = member.ids.filter((id) => !owned.some((b) => b.id === id));
  if (extraIds.length === 0) return { rows: owned, error: null };
  const { data: memberBiz, error: memberErr } = await supabase
    .from('business_profiles')
    .select('*')
    .in('id', extraIds)
    .order('created_at', { ascending: true });
  return { rows: [...owned, ...((memberBiz ?? []) as BusinessProfile[])], error: memberErr };
}

/**
 * Business-ul activ al ownerului: cel selectat (daca inca ii apartine),
 * altfel primul. Inlocuieste pattern-ul .maybeSingle() pe owner_user_id,
 * care alegea arbitrar cand exista mai multe business-uri.
 */
export async function fetchMyBusiness(ownerUserId: string): Promise<BusinessProfile | null> {
  return (await fetchMyBusinessResult(ownerUserId)).data;
}

/** Aceeasi forma ca un query Supabase, pentru inlocuirea .maybeSingle() pe owner. */
export async function fetchMyBusinessResult(
  ownerUserId: string
): Promise<{ data: BusinessProfile | null; error: { message: string } | null }> {
  const { rows, error } = await listMyBusinessesResult(ownerUserId);
  if (error) return { data: null, error };
  if (rows.length === 0) return { data: null, error: null };
  const selectedId = await getSelectedBusinessId();
  return { data: rows.find((b) => b.id === selectedId) ?? rows[0], error: null };
}

export async function fetchMyBusinessId(ownerUserId: string): Promise<string | null> {
  const business = await fetchMyBusiness(ownerUserId);
  return business?.id ?? null;
}
