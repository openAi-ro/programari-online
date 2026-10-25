import { CHECKIN_OPEN_BEFORE_MS } from './checkin';
import { generateFreeSlots } from './slots';
import { addOneDay, formatInTimeZone } from './timezone';
import { trKey } from './i18n';
import type { Appointment, BreakHours, BusinessProfile, Staff, WorkingHours } from './types';

export function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First local date that still has at least one slot after min notice / working hours. */
export function firstBookableDateYmd(opts: {
  timezone: string;
  workingHours: WorkingHours;
  breakHours: BreakHours;
  blockedDates?: string[];
  minNoticeMinutes?: number;
  maxAdvanceDays?: number;
  sessionDurationMinutes: number;
  bufferMinutes?: number;
}): string {
  const blocked = opts.blockedDates ?? [];
  const notBefore = addMinutes(new Date(), opts.minNoticeMinutes ?? 0);
  const maxDays = Math.max(1, opts.maxAdvanceDays ?? 90);

  // Zilele se parcurg in fusul firmei, nu in fusul telefonului.
  let ymd = formatInTimeZone(new Date(), opts.timezone, 'yyyy-MM-dd');
  const todayYmd = ymd;
  for (let i = 0; i < maxDays; i++) {
    const slots = generateFreeSlots({
      dateLocal: ymd,
      timezone: opts.timezone,
      sessionDurationMinutes: opts.sessionDurationMinutes,
      workingHours: opts.workingHours,
      breakHours: opts.breakHours,
      busy: [],
      bufferMinutes: opts.bufferMinutes ?? 0,
      blockedDates: blocked,
      notBeforeUtc: notBefore,
    });
    if (slots.length > 0) return ymd;
    ymd = addOneDay(ymd);
  }
  return todayYmd;
}

/**
 * Prima zi rezervabilă pentru specialiștii dați (cea mai devreme dintre ei).
 * Listă goală = programul salonului (fără echipă).
 */
export function firstBookableDateForStaff(
  business: Pick<
    BusinessProfile,
    | 'timezone'
    | 'working_hours'
    | 'break_hours'
    | 'blocked_dates'
    | 'min_notice_minutes'
    | 'max_advance_days'
    | 'buffer_minutes'
  >,
  members: readonly Staff[],
  sessionDurationMinutes: number
): string {
  const pool: readonly (Staff | null)[] = members.length > 0 ? members : [null];
  return pool
    .map((member) => {
      const hours = staffSchedule(member, business);
      return firstBookableDateYmd({
        timezone: business.timezone,
        workingHours: hours.workingHours,
        breakHours: hours.breakHours,
        blockedDates: business.blocked_dates ?? [],
        minNoticeMinutes: business.min_notice_minutes ?? 0,
        maxAdvanceDays: business.max_advance_days ?? 90,
        sessionDurationMinutes,
        bufferMinutes: business.buffer_minutes ?? 0,
      });
    })
    .reduce((a, b) => (b < a ? b : a));
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function notBeforeUtc(business: Pick<BusinessProfile, 'min_notice_minutes'>): Date {
  return addMinutes(new Date(), business.min_notice_minutes ?? 0);
}

export function maxBookingDate(
  business: Pick<BusinessProfile, 'max_advance_days' | 'timezone'>
): Date {
  const days = business.max_advance_days ?? 90;
  if (!business.timezone) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + days);
    return d;
  }
  // Data maxima se calculeaza pe calendarul firmei; pranzul local evita
  // decalajele de fus la conversia inapoi in YYYY-MM-DD.
  let ymd = formatInTimeZone(new Date(), business.timezone, 'yyyy-MM-dd');
  for (let i = 0; i < days; i++) ymd = addOneDay(ymd);
  return new Date(`${ymd}T12:00:00`);
}

export function canClientCancel(
  apt: Pick<Appointment, 'status' | 'start_at'>,
  business: Pick<BusinessProfile, 'cancel_notice_minutes'> | null | undefined,
  now = new Date()
): boolean {
  if (apt.status !== 'pending' && apt.status !== 'approved') return false;
  if (new Date(apt.start_at) <= now) return false;
  if (apt.status === 'pending') return true;
  const notice = business?.cancel_notice_minutes ?? 120;
  return new Date(apt.start_at).getTime() - now.getTime() >= notice * 60 * 1000;
}

export function canClientReschedule(
  apt: Pick<Appointment, 'status' | 'start_at'>,
  business: Pick<BusinessProfile, 'cancel_notice_minutes'> | null | undefined,
  now = new Date()
): boolean {
  return canClientCancel(apt, business, now);
}

export function canConfirmAttendance(
  apt: Pick<Appointment, 'status' | 'start_at' | 'attendance_confirmed' | 'no_show'>,
  now = new Date()
): boolean {
  if (apt.status !== 'approved') return false;
  if (apt.attendance_confirmed) return false;
  if (apt.no_show) return false;
  // Doar până se deschide fereastra de sosire; apoi cardul arată „Am ajuns”.
  return new Date(apt.start_at).getTime() - CHECKIN_OPEN_BEFORE_MS > now.getTime();
}

export function canMarkNoShow(
  apt: Pick<Appointment, 'status' | 'start_at' | 'no_show'>,
  now = new Date()
): boolean {
  if (apt.status !== 'approved') return false;
  if (apt.no_show) return false;
  return new Date(apt.start_at) <= now;
}

/** Deposit/avans UI removed — always null so cards never prompt for payment. */
export function paymentLabel(
  _status: Appointment['payment_status'],
  _depositRon?: number | null
): string | null {
  return null;
}

export function mapBookingRpcError(message: string): string {
  if (message.includes('booking_empty_result') || /appointment_status|42804/.test(message)) {
    return trKey('book.errNotSaved');
  }
  if (message.includes('contact_required')) {
    return trKey('book.errContactRequired');
  }
  if (message.includes('too_many_guest')) {
    return trKey('book.errTooManyGuest');
  }
  if (message.includes('guest_rate_limited')) {
    return trKey('book.errGuestRateLimited');
  }
  if (message.includes('invalid_name')) {
    return trKey('book.errBadName');
  }
  if (message.includes('slot_taken')) {
    return trKey('book.errSlotTaken');
  }
  if (message.includes('not_authenticated')) {
    return trKey('auth.errMustSignIn');
  }
  if (message.includes('too_soon')) {
    return trKey('book.errTooSoon');
  }
  if (message.includes('too_far')) {
    return trKey('book.errTooFar');
  }
  if (message.includes('day_blocked')) {
    return trKey('book.errDayBlocked');
  }
  if (message.includes('service_not_found')) {
    return trKey('book.errServiceGone');
  }
  if (message.includes('too_late')) {
    return trKey('book.errTooLate');
  }
  if (message.includes('cannot_cancel')) {
    return trKey('book.errCannotCancel');
  }
  if (message.includes('cannot_reschedule')) {
    return trKey('book.errCannotReschedule');
  }
  if (message.includes('cannot_confirm')) {
    return trKey('book.errCannotConfirm');
  }
  if (message.includes('cannot_leave')) {
    return trKey('book.errCannotLeave');
  }
  if (message.includes('client_blocked')) {
    return trKey('book.errClientBlocked');
  }
  if (message.includes('cannot_mark_noshow')) {
    return trKey('book.errCannotNoShow');
  }
  if (message.includes('cannot_mark_paid')) {
    return trKey('book.errCannotPaid');
  }
  if (message.includes('cannot_waive')) {
    return trKey('book.errCannotWaive');
  }
  if (message.includes('staff_service_mismatch')) {
    return trKey('book.errStaffService');
  }
  if (message.includes('staff_not_found')) {
    return trKey('book.errStaffGone');
  }
  if (message.includes('not_business_owner')) {
    return trKey('book.errNotOwner');
  }
  if (message.includes('walkin_contact_required')) {
    return trKey('book.errWalkinContact');
  }
  if (message.includes('walkin_slot_required')) {
    return trKey('book.errWalkinSlot');
  }
  if (message.includes('invalid_phone')) {
    return trKey('book.errBadPhone');
  }
  if (message.includes('invalid_email')) {
    return trKey('book.errBadEmail');
  }
  if (message.includes('invalid_range')) {
    return trKey('book.errBadRange');
  }
  if (message.includes('cannot_move')) {
    return trKey('book.errCannotMove');
  }
  if (message.includes('move_slot_required')) {
    return trKey('book.errMoveSlot');
  }
  if (message.includes('move_in_past')) {
    return trKey('book.errMovePast');
  }
  if (message.includes('move_same_slot')) {
    return trKey('book.errMoveSame');
  }
  if (message.includes('move_notify_failed')) {
    return trKey('book.errMoveNotify');
  }
  if (message.includes('cannot_review')) {
    return trKey('book.errCannotReview');
  }
  if (message.includes('invalid_rating')) {
    return trKey('book.errBadRating');
  }
  return message;
}

export function staffSchedule(
  staff: Pick<Staff, 'working_hours' | 'break_hours'> | null | undefined,
  business: Pick<BusinessProfile, 'working_hours' | 'break_hours'>
): { workingHours: WorkingHours; breakHours: BreakHours } {
  return {
    workingHours: staff?.working_hours ?? business.working_hours,
    breakHours: staff?.break_hours ?? business.break_hours,
  };
}

export function canReview(
  apt: Pick<Appointment, 'status' | 'end_at' | 'no_show'>,
  now = new Date()
): boolean {
  if (apt.status !== 'approved') return false;
  if (apt.no_show) return false;
  return new Date(apt.end_at) <= now;
}

/** Vizite rămase până la ședința gratuită; null = loialitate oprită. */
export function visitsUntilFree(visitCount: number, every: number): number | null {
  if (!every || every < 2) return null;
  const mod = visitCount % every;
  return mod === 0 ? every : every - mod;
}
