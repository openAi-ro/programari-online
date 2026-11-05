import { notBeforeUtc, staffSchedule } from './bookingRules';
import { listBusyRanges } from './bookingRpc';
import { generateFreeSlots } from './slots';
import { localDayBoundsUtc } from './timezone';
import type { BusinessProfile, FreeSlot, Staff } from './types';

/**
 * Orele libere dintr-o zi pentru un specialist (programul și ocupările lui).
 * `member` null = firma fără echipă (programul firmei, ocupările tuturor).
 */
export async function loadStaffDaySlots(opts: {
  business: BusinessProfile;
  member: Staff | null;
  dateLocal: string;
  durationMinutes: number;
}): Promise<{ slots: FreeSlot[]; error: string | null }> {
  const { business, member, dateLocal, durationMinutes } = opts;
  const { startUtc, endUtc } = localDayBoundsUtc(dateLocal, business.timezone);
  const { busy, error } = await listBusyRanges({
    businessId: business.id,
    fromIso: startUtc.toISOString(),
    toIso: endUtc.toISOString(),
    staffId: member?.id ?? null,
  });
  if (error) return { slots: [], error };
  const hours = staffSchedule(member, business);
  return {
    slots: generateFreeSlots({
      dateLocal,
      timezone: business.timezone,
      sessionDurationMinutes: durationMinutes,
      workingHours: hours.workingHours,
      breakHours: hours.breakHours,
      busy,
      bufferMinutes: business.buffer_minutes ?? 0,
      blockedDates: business.blocked_dates ?? [],
      notBeforeUtc: notBeforeUtc(business),
    }),
    error: null,
  };
}
