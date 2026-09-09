import type { AppointmentStatus } from './types';

type StatusMeta = {
  label: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  icon: 'time-outline' | 'checkmark-circle-outline' | 'close-circle-outline' | 'ban-outline';
};

export const STATUS_META: Record<AppointmentStatus, StatusMeta> = {
  pending: { label: 'În așteptare', tone: 'warning', icon: 'time-outline' },
  approved: { label: 'Confirmată', tone: 'success', icon: 'checkmark-circle-outline' },
  rejected: { label: 'Respinsă', tone: 'danger', icon: 'close-circle-outline' },
  cancelled: { label: 'Anulată', tone: 'neutral', icon: 'ban-outline' },
};
