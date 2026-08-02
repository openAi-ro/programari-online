import type { BreakHours, WorkingHours } from './types';

export const DEFAULT_TIMEZONE = 'Europe/Bucharest';

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  mon: { closed: false, start: '09:00', end: '17:00' },
  tue: { closed: false, start: '09:00', end: '17:00' },
  wed: { closed: false, start: '09:00', end: '17:00' },
  thu: { closed: false, start: '09:00', end: '17:00' },
  fri: { closed: false, start: '09:00', end: '17:00' },
  sat: { closed: true },
  sun: { closed: true },
};

export const DEFAULT_BREAK_HOURS: BreakHours = {
  enabled: false,
  start: '13:00',
  end: '14:00',
};
