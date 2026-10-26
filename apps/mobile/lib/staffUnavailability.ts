import { supabase } from './supabase';
import { validateUnavailabilityRange } from './staffUnavailabilityRules';

/** Indisponibilitate a unui specialist (v90): interval de date în fusul salonului. */
export type StaffUnavailability = {
  id: string;
  business_id: string;
  staff_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD, inclusiv
  reason: string | null;
  created_at: string;
};

export {
  unavailabilityCoversDate,
  unavailabilityOverlapsRange,
  validateUnavailabilityRange,
} from './staffUnavailabilityRules';

export async function fetchStaffUnavailability(opts: {
  businessId: string;
  fromYmd: string;
  toYmd: string;
  staffId?: string | null;
}): Promise<{ rows: StaffUnavailability[]; error: string | null }> {
  let query = supabase
    .from('staff_unavailability')
    .select('*')
    .eq('business_id', opts.businessId)
    .lte('start_date', opts.toYmd)
    .gte('end_date', opts.fromYmd)
    .order('start_date', { ascending: true });
  if (opts.staffId) query = query.eq('staff_id', opts.staffId);
  const { data, error } = await query;
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as StaffUnavailability[], error: null };
}

export async function createStaffUnavailability(opts: {
  businessId: string;
  staffId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  createdBy: string | null;
}): Promise<{ error: string | null }> {
  const invalid = validateUnavailabilityRange(opts.startDate, opts.endDate);
  if (invalid) return { error: invalid };
  const { error } = await supabase.from('staff_unavailability').insert({
    business_id: opts.businessId,
    staff_id: opts.staffId,
    start_date: opts.startDate,
    end_date: opts.endDate,
    reason: opts.reason,
    created_by: opts.createdBy,
  });
  return { error: error?.message ?? null };
}

export async function deleteStaffUnavailability(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('staff_unavailability').delete().eq('id', id);
  return { error: error?.message ?? null };
}
