/**
 * v101 (3.03): reguli pure pentru programarea rapidă din business (fără Supabase) →
 * testabile cu `npx tsx lib/quickAddRules.test.ts`.
 */
import { normalizePhoneE164 } from './phone';

export type BusinessClientContact = {
  /** fișa business_clients; null = client cu cont fără fișă încă */
  businessClientId: string | null;
  clientUserId: string | null;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  visitCount: number;
};

export type ContactClientRow = {
  business_client_id: string;
  business_id: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  visit_count: number;
  last_start_at: string | null;
  upcoming_count: number;
};

export type QuickAddDraft = {
  serviceIds: readonly string[];
  slotStartUtc: string | null;
  picked: BusinessClientContact | null;
  name: string;
  phone: string;
  email: string;
};

export type QuickAddPayload = {
  p_service_ids: string[];
  p_start_at: string;
  p_client_id: string | null;
  p_client_user_id: string | null;
  p_client_name: string | null;
  p_client_phone: string | null;
  p_client_email: string | null;
};

/** Căutarea pornește de la 2 caractere (serverul ignoră mai puțin). */
export const MIN_CLIENT_QUERY = 2;

export function quickAddQueryReady(q: string): boolean {
  return q.trim().length >= MIN_CLIENT_QUERY;
}

/**
 * Validare locală + payload pentru RPC. Clientul ales din listă câștigă; altfel e nevoie
 * de telefon valid sau email (fără cont, fără email: doar telefonul e suficient).
 */
export function buildQuickAddPayload(
  d: QuickAddDraft
): { payload: QuickAddPayload | null; error: string | null } {
  if (d.serviceIds.length === 0) return { payload: null, error: 'service_required' };
  if (!d.slotStartUtc) return { payload: null, error: 'walkin_slot_required' };
  const name = d.name.trim() || null;
  const phoneRaw = d.phone.trim();
  const emailRaw = d.email.trim().toLowerCase();
  const phone = phoneRaw ? normalizePhoneE164(phoneRaw) : null;
  if (phoneRaw && !phone) return { payload: null, error: 'invalid_phone' };
  if (emailRaw && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailRaw)) {
    return { payload: null, error: 'invalid_email' };
  }
  const picked = d.picked;
  if (!picked && !phone && !emailRaw) return { payload: null, error: 'walkin_contact_required' };
  return {
    payload: {
      p_service_ids: [...d.serviceIds],
      p_start_at: d.slotStartUtc,
      p_client_id: picked?.businessClientId ?? null,
      p_client_user_id: picked && !picked.businessClientId ? picked.clientUserId : null,
      p_client_name: name,
      p_client_phone: phone,
      p_client_email: emailRaw || null,
    },
    error: null,
  };
}

/** Toggle-ul „Anunță clientul" are sens doar pentru o programare care n-a trecut. */
export function canNotifyClient(slotEndUtc: string | null, now: Date = new Date()): boolean {
  return !!slotEndUtc && Date.parse(slotEndUtc) > now.getTime();
}

/** Zile de la (azi - pastDays) la (azi + futureDays), YYYY-MM-DD, pentru selectorul de zi. */
export function quickAddDays(todayYmd: string, pastDays: number, futureDays: number): string[] {
  const base = new Date(`${todayYmd}T12:00:00Z`);
  const out: string[] = [];
  for (let i = -pastDays; i <= futureDays; i += 1) {
    const d = new Date(base.getTime() + i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
