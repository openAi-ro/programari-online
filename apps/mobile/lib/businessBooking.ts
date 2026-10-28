/**
 * v101 (3.03): programare rapidă din business (calendar FAB / Clienți → „Programează").
 * Înlocuiește lib/walkin.ts + walkinClientSearch (create_walkin): un singur RPC pe server
 * (business_create_appointment) care face rolurile, dedupe-ul pe telefon și verificarea slotului.
 */
import { mapBookingRpcError } from './bookingRules';
import { trKey } from './i18n';
import { unwrapRpcRow } from './bookingRpc';
import { supabase } from './supabase';
import type { Appointment } from './types';
import {
  quickAddQueryReady,
  type BusinessClientContact,
  type ContactClientRow,
  type QuickAddPayload,
} from './quickAddRules';

export type { BusinessClientContact, ContactClientRow } from './quickAddRules';

export function mapQuickAddError(message: string): string {
  if (message.includes('service_required')) return trKey('qa.errService');
  if (message.includes('too_far_past')) return trKey('qa.errTooFarPast');
  if (message.includes('staff_own_only') || message.includes('staff_not_linked')) {
    return trKey('qa.errStaffOwn');
  }
  if (message.includes('client_not_found')) return trKey('qa.errClientGone');
  if (message.includes('walkin_contact_required')) return trKey('qa.errContact');
  return mapBookingRpcError(message);
}

export async function searchBusinessClientContacts(
  businessId: string,
  query: string
): Promise<{ clients: BusinessClientContact[]; error: string | null }> {
  if (!quickAddQueryReady(query)) return { clients: [], error: null };
  const { data, error } = await supabase.rpc('search_business_client_contacts', {
    p_business_id: businessId,
    p_query: query.trim(),
  });
  if (error) return { clients: [], error: error.message };
  const clients = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    businessClientId: (r.business_client_id as string | null) ?? null,
    clientUserId: (r.client_user_id as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    phone: (r.phone as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    visitCount: Number(r.visit_count ?? 0),
  }));
  return { clients, error: null };
}

export async function createBusinessAppointment(opts: {
  businessId: string;
  staffId: string | null;
  payload: QuickAddPayload;
  note: string;
  notifyClient: boolean;
}): Promise<{ appointment: Appointment | null; error: string | null }> {
  const { data, error } = await supabase.rpc('business_create_appointment', {
    p_business_id: opts.businessId,
    p_staff_id: opts.staffId,
    ...opts.payload,
    p_note: opts.note.trim() || null,
    p_notify_client: opts.notifyClient,
  });
  if (error) return { appointment: null, error: error.message };
  return { appointment: unwrapRpcRow<Appointment>(data), error: null };
}

export async function listBusinessContactClients(): Promise<{
  rows: ContactClientRow[];
  error: string | null;
}> {
  const { data, error } = await supabase.rpc('list_business_contact_clients');
  if (error) return { rows: [], error: error.message };
  return {
    rows: ((data ?? []) as ContactClientRow[]).map((r) => ({
      ...r,
      visit_count: Number(r.visit_count ?? 0),
      upcoming_count: Number(r.upcoming_count ?? 0),
    })),
    error: null,
  };
}

let lastLinkAt = 0;
/**
 * v101: leagă fișele fără cont (create de business) de contul curent, DOAR pe
 * telefon/email verificate (server). Idempotent; erorile sunt ignorate (ex. înainte de v101).
 */
export function linkMyBusinessClients(): void {
  const now = Date.now();
  if (now - lastLinkAt < 60_000) return;
  lastLinkAt = now;
  void supabase.rpc('link_my_business_clients').then(({ error }) => {
    if (error) console.warn('link_my_business_clients', error.message);
  });
}
