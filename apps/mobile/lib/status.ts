import { trKey } from './i18n';
import type { AppointmentStatus } from './types';

type StatusMeta = {
  label: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  icon: 'time-outline' | 'checkmark-circle-outline' | 'close-circle-outline' | 'ban-outline';
};

const TONE_ICON: Record<
  AppointmentStatus,
  { tone: StatusMeta['tone']; icon: StatusMeta['icon'] }
> = {
  pending: { tone: 'warning', icon: 'time-outline' },
  approved: { tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { tone: 'danger', icon: 'close-circle-outline' },
  cancelled: { tone: 'neutral', icon: 'ban-outline' },
};

const LABEL_KEY: Record<AppointmentStatus, 'status.pending' | 'status.approved' | 'status.rejected' | 'status.cancelled'> = {
  pending: 'status.pending',
  approved: 'status.approved',
  rejected: 'status.rejected',
  cancelled: 'status.cancelled',
};

/** Eticheta de status în limba curentă (re-randată de componente via useT). */
export function statusLabel(status: AppointmentStatus): string {
  return trKey(LABEL_KEY[status]);
}

/** Meta complet de status, cu eticheta tradusă. */
export function statusMeta(status: AppointmentStatus): StatusMeta {
  return { label: statusLabel(status), ...TONE_ICON[status] };
}
