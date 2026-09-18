import { generateFreeSlots } from './slots';
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
  const last = new Date();
  last.setHours(0, 0, 0, 0);
  last.setDate(last.getDate() + (opts.maxAdvanceDays ?? 90));

  const d = new Date();
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 21; i++) {
    if (d > last) break;
    const ymd = toYmd(d);
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
    d.setDate(d.getDate() + 1);
  }
  return toYmd(new Date());
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function notBeforeUtc(business: Pick<BusinessProfile, 'min_notice_minutes'>): Date {
  return addMinutes(new Date(), business.min_notice_minutes ?? 0);
}

export function maxBookingDate(
  business: Pick<BusinessProfile, 'max_advance_days'>
): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (business.max_advance_days ?? 90));
  return d;
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
  return new Date(apt.start_at) > now;
}

export function canMarkNoShow(
  apt: Pick<Appointment, 'status' | 'start_at' | 'no_show'>,
  now = new Date()
): boolean {
  if (apt.status !== 'approved') return false;
  if (apt.no_show) return false;
  return new Date(apt.start_at) <= now;
}

export function paymentLabel(
  status: Appointment['payment_status'],
  depositRon?: number | null
): string | null {
  if (!status || status === 'none') return null;
  const sum = depositRon && depositRon > 0 ? ` (${depositRon} lei)` : '';
  if (status === 'unpaid') return `Avans de plătit${sum}`;
  if (status === 'paid') return `Avans plătit${sum}`;
  if (status === 'refunded') return 'Avans restituit';
  if (status === 'waived') return 'Avans scutit';
  return null;
}

export function mapBookingRpcError(message: string): string {
  if (message.includes('booking_empty_result') || /appointment_status|42804/.test(message)) {
    return 'Programarea nu s-a salvat. Încearcă din nou.';
  }
  if (message.includes('contact_required')) {
    return 'Contul trebuie să aibă email sau telefon.';
  }
  if (message.includes('slot_taken')) {
    return 'Slotul tocmai a fost rezervat. Alege altul.';
  }
  if (message.includes('not_authenticated')) {
    return 'Trebuie să fii autentificat.';
  }
  if (message.includes('too_soon')) {
    return 'Prea aproape de oră — alege un slot mai târziu (preaviz minim).';
  }
  if (message.includes('too_far')) {
    return 'Data e prea departe în viitor pentru acest business.';
  }
  if (message.includes('day_blocked')) {
    return 'Business-ul nu primește programări în această zi.';
  }
  if (message.includes('service_not_found')) {
    return 'Serviciul nu mai este disponibil.';
  }
  if (message.includes('too_late')) {
    return 'Prea târziu pentru anulare sau reprogramare. Contactează business-ul.';
  }
  if (message.includes('cannot_cancel')) {
    return 'Această programare nu mai poate fi anulată.';
  }
  if (message.includes('cannot_reschedule')) {
    return 'Această programare nu mai poate fi reprogramată.';
  }
  if (message.includes('cannot_confirm')) {
    return 'Nu poți confirma prezența pentru această programare.';
  }
  if (message.includes('cannot_leave')) {
    return 'Nu mai poți ieși din lista de așteptare.';
  }
  if (message.includes('client_blocked')) {
    return 'Acest business te-a blocat. Nu poți face programări noi.';
  }
  if (message.includes('cannot_mark_noshow')) {
    return 'Poți marca absența doar după ora programării, pe o ședință confirmată.';
  }
  if (message.includes('cannot_mark_paid')) {
    return 'Avansul nu mai poate fi marcat ca plătit.';
  }
  if (message.includes('cannot_waive')) {
    return 'Avansul nu mai poate fi scutit.';
  }
  if (message.includes('staff_not_found')) {
    return 'Specialistul nu mai este disponibil.';
  }
  if (message.includes('cannot_review')) {
    return 'Poți lăsa recenzie după o vizită confirmată.';
  }
  if (message.includes('invalid_rating')) {
    return 'Alege un rating de la 1 la 5.';
  }
  return message;
}

export function staffSchedule(
  staff: Staff | null | undefined,
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
