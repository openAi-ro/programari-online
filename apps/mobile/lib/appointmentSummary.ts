import { formatDuration, formatRon } from './format';

/** Serviciul de pe card, cu durata și prețul salvate la rezervare: „Tuns + Vopsit · 2 ore · 200 lei”. */
export function serviceSummary(appointment: {
  service_name?: string | null;
  service_duration_minutes?: number | null;
  service_price?: number | string | null;
}): string {
  const parts: string[] = [];
  const name = appointment.service_name?.trim();
  if (name) parts.push(name);
  const minutes = appointment.service_duration_minutes;
  if (typeof minutes === 'number' && minutes > 0) parts.push(formatDuration(minutes));
  if (appointment.service_price != null) parts.push(formatRon(appointment.service_price));
  return parts.join(' · ');
}
