import { trKey } from './i18n';
import type { AppointmentStatus } from '@/lib/types';

/**
 * One-line next-step hint for appointment cards / Home next card.
 * Keep short — UI uses numberOfLines={2} + flexShrink.
 */
export function appointmentNextHint(
  status: AppointmentStatus,
  opts?: {
    noShow?: boolean;
    attendanceConfirmed?: boolean;
    canCancel?: boolean;
    canReschedule?: boolean;
    /** Aprobată, încă neîncepută, dar în termenul în care clientul nu mai poate anula/muta. */
    tooLate?: boolean;
  }
): string {
  if (opts?.noShow) return trKey('hint.noShow');
  if (status === 'approved' && opts?.tooLate && !opts.canCancel && !opts.canReschedule) {
    return trKey('hint.tooLateToChange');
  }

  if (status === 'pending' || status === 'approved') {
    // Textul spune doar ce se poate face acum (ex. în timpul unei propuneri a salonului
    // reprogramarea e blocată, deci nu o mai pomenim).
    if (opts?.canReschedule) {
      return trKey(status === 'pending' ? 'hint.pendingCanChange' : 'hint.approvedCanChange');
    }
    if (opts?.canCancel) {
      return trKey(status === 'pending' ? 'hint.pendingCanCancel' : 'hint.approvedCanCancel');
    }
  }

  switch (status) {
    case 'pending':
      return trKey('hint.pending');
    case 'approved':
      return opts?.attendanceConfirmed
        ? trKey('hint.attendanceConfirmed')
        : trKey('hint.approved');
    case 'rejected':
      return trKey('hint.rejected');
    case 'cancelled':
      return trKey('hint.cancelled');
    default:
      return trKey('hint.details');
  }
}
