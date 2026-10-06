import type { AppointmentStatus } from '@/lib/types';

/**
 * One-line Romanian next-step hint for appointment cards / Home next card.
 * Keep short — UI uses numberOfLines={2} + flexShrink.
 */
export function appointmentNextHint(
  status: AppointmentStatus,
  opts?: {
    noShow?: boolean;
    attendanceConfirmed?: boolean;
    canCancel?: boolean;
    canReschedule?: boolean;
  }
): string {
  if (opts?.noShow) return 'Nu te-ai prezentat — poți rezerva din nou';

  if (
    (status === 'pending' || status === 'approved') &&
    (opts?.canCancel || opts?.canReschedule)
  ) {
    if (status === 'pending') return 'Așteaptă confirmarea — poți anula sau reprograma';
    return 'Poți reprograma sau anula';
  }

  switch (status) {
    case 'pending':
      return 'Așteaptă confirmarea salonului';
    case 'approved':
      return opts?.attendanceConfirmed
        ? 'Prezență confirmată — vezi ora și adresa'
        : 'Ești confirmat — vezi ora și adresa';
    case 'rejected':
      return 'Cerere respinsă — poți rezerva din nou';
    case 'cancelled':
      return 'Programare anulată — poți rezerva din nou';
    default:
      return 'Vezi detaliile programării';
  }
}
