import { supabase } from '@/lib/supabase';

/**
 * Pozele de profil ale clienților cu programare la business-urile mele (RPC v112).
 * Orice eroare (inclusiv funcția încă neaplicată pe server) → {} și cardul arată inițialele.
 */
export async function loadClientAvatars(businessIds: string[], clientIds: string[]): Promise<Record<string, string>> {
  if (businessIds.length === 0 || clientIds.length === 0) return {};
  const { data, error } = await supabase.rpc('list_related_client_avatars', {
    p_business_ids: businessIds,
    p_client_ids: clientIds,
  });
  if (error || !Array.isArray(data)) return {};
  const map: Record<string, string> = {};
  for (const row of data as { user_id: string; avatar_url: string | null }[]) {
    if (row.user_id && row.avatar_url) map[row.user_id] = row.avatar_url;
  }
  return map;
}
