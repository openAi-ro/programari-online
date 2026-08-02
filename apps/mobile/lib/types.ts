export type AppointmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type DayHours = { closed: true } | { closed: false; start: string; end: string }; // "HH:mm"

export type WorkingHours = Record<DayKey, DayHours>;

export type BreakHours = { enabled: boolean; start: string; end: string }; // local business time

export type Profile = {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
};

export type BusinessProfile = {
  id: string;
  owner_user_id: string;
  name: string;
  public_code: string;
  timezone: string;
  session_duration_minutes: number;
  working_hours: WorkingHours;
  break_hours: BreakHours;
  created_at: string;
  updated_at: string;
};

export type Appointment = {
  id: string;
  business_id: string;
  client_user_id: string;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  client_email: string | null;
  client_phone: string | null;
  reminder_sent: boolean;
  decision_notified: boolean;
  created_at: string;
  updated_at: string;
};

export type FreeSlot = {
  startUtc: string; // ISO
  endUtc: string;
  labelLocal: string; // e.g. "09:30"
};
