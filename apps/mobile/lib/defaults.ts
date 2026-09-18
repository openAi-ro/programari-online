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

export const DEFAULT_MIN_NOTICE_MINUTES = 120;
export const DEFAULT_BUFFER_MINUTES = 0;
export const DEFAULT_MAX_ADVANCE_DAYS = 90;
export const DEFAULT_CANCEL_NOTICE_MINUTES = 120;
export const DEFAULT_DEPOSIT_RON = 0;
export const DEFAULT_AUTO_APPROVE_RETURNING = false;
export const DEFAULT_NO_SHOW_BLOCK_AFTER = 2;
export const DEFAULT_LOYALTY_EVERY = 0;

export const STAFF_COLORS = ['#5B6CFF', '#E85D4C', '#2A9D8F', '#E9C46A', '#9B5DE5', '#F4A261'];
