import { Platform, Share } from 'react-native';

import { supabase } from './supabase';

/** Toate datele contului curent (client + business), pentru export GDPR. */
export async function collectMyData(): Promise<Record<string, unknown> | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [profile, appointments, favorites, reviews, waitlist, businesses] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('appointments').select('*').eq('client_user_id', user.id),
    supabase.from('client_favorites').select('*').eq('user_id', user.id),
    supabase.from('reviews').select('*').eq('client_user_id', user.id),
    supabase.from('waitlist').select('*').eq('client_user_id', user.id),
    supabase.from('business_profiles').select('*').eq('owner_user_id', user.id),
  ]);

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email },
    profile: profile.data ?? null,
    appointments_as_client: appointments.data ?? [],
    favorites: favorites.data ?? [],
    reviews: reviews.data ?? [],
    waitlist: waitlist.data ?? [],
    businesses: businesses.data ?? [],
  };
  const firstError = [profile, appointments, favorites, reviews, waitlist, businesses].find((r) => r.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const bizIds = ((businesses.data ?? []) as Array<{ id: string }>).map((b) => b.id);
  if (bizIds.length) {
    const [services, staff, bizAppointments] = await Promise.all([
      supabase.from('services').select('*').in('business_id', bizIds),
      supabase.from('staff').select('*').in('business_id', bizIds),
      supabase.from('appointments').select('*').in('business_id', bizIds),
    ]);
    out.services = services.data ?? [];
    out.staff = staff.data ?? [];
    out.appointments_as_business = bizAppointments.data ?? [];
    const bizError = [services, staff, bizAppointments].find((r) => r.error)?.error;
    if (bizError) throw new Error(bizError.message);
  }

  return out;
}

/** Descarca (web) sau partajeaza (native) exportul JSON al contului. */
export async function exportMyData(): Promise<{ ok: boolean; error?: string }> {
  let data: Record<string, unknown> | null;
  try {
    data = await collectMyData();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!data) return { ok: false, error: 'not_authenticated' };
  const json = JSON.stringify(data, null, 2);

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'programari-datele-mele.json';
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  }

  await Share.share({ message: json });
  return { ok: true };
}

/** Sterge contul prin Edge Function (service role) si inchide sesiunea local. */
export async function deleteMyAccount(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) return { ok: false, error: error.message };
  const payload = data as { ok?: boolean; error?: string } | null;
  if (payload?.error) return { ok: false, error: payload.error };
  await supabase.auth.signOut();
  return { ok: true };
}
