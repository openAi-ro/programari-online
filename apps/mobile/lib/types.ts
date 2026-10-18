export type AppointmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export type PaymentStatus = 'none' | 'unpaid' | 'paid' | 'refunded' | 'waived';

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type DayHours = { closed: true } | { closed: false; start: string; end: string }; // "HH:mm"

export type WorkingHours = Record<DayKey, DayHours>;

export type BreakHours = { enabled: boolean; start: string; end: string }; // local business time

export type Profile = {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  account_kind?: 'client' | 'business' | null;
  /** Reminder WhatsApp/email cu 1h și 24h înainte de programare. */
  notify_reminders?: boolean;
  /** Mesaj la aprobare/respingere din partea business-ului. */
  notify_decision?: boolean;
  /** Dacă false, telefonul rămâne contact fără mesaje WhatsApp. */
  notify_whatsapp?: boolean;
  /** Poza de profil (client/business) — URL public din storage. */
  avatar_url?: string | null;
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
  min_notice_minutes: number;
  buffer_minutes: number;
  max_advance_days: number;
  cancel_notice_minutes: number;
  blocked_dates: string[];
  deposit_ron: number;
  auto_approve_returning: boolean;
  no_show_block_after: number;
  loyalty_every: number;
  /** Locație — toate opționale; cardul de hartă apare doar dacă există date. */
  /** Cod ISO tara (RO/GB/MD/...); implicit RO. */
  country?: string | null;
  county?: string | null;
  city?: string | null;
  address?: string | null;
  maps_url?: string | null;
  google_review_url?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  offpeak_discount_percent?: number | null;
  offpeak_start_hour?: number | null;
  offpeak_end_hour?: number | null;
  referral_enabled?: boolean | null;
  referral_reward_text?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Logo firmă (separat de poza de profil). */
  logo_url?: string | null;
  /** Video de prezentare (URL public din storage) — afișat clienților la căutare. */
  promo_video_url?: string | null;
  /** Cheie categorie browse (BROWSE_CATEGORIES.key), ex. coafura. */
  category?: string | null;
  created_at: string;
  updated_at: string;
};

export type Service = {
  id: string;
  business_id: string;
  name: string;
  description?: string | null;
  duration_minutes: number;
  price: number;
  rebook_interval_days?: number | null;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Appointment = {
  id: string;
  business_id: string;
  /** Null pentru rezervarile ca invitat (fara cont). */
  client_user_id: string | null;
  start_at: string;
  end_at: string;
  status: AppointmentStatus;
  client_email: string | null;
  client_phone: string | null;
  guest_name?: string | null;
  reminder_sent: boolean;
  reminder_24h_sent?: boolean;
  decision_notified: boolean;
  attendance_confirmed?: boolean;
  service_id?: string | null;
  service_ids?: string[] | null;
  checked_in_at?: string | null;
  service_name?: string | null;
  service_duration_minutes?: number | null;
  service_price?: number | null;
  payment_status?: PaymentStatus;
  deposit_ron?: number;
  no_show?: boolean;
  staff_id?: string | null;
  staff_name?: string | null;
  loyalty_redeemed?: boolean;
  /** Serie saptamanala (v38); null pentru programari simple. */
  recurring_series_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type Staff = {
  id: string;
  business_id: string;
  name: string;
  photo_url?: string | null;
  portfolio_urls?: string[] | null;
  color: string;
  active: boolean;
  sort_order: number;
  working_hours: WorkingHours | null;
  break_hours: BreakHours | null;
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  business_id: string;
  appointment_id: string;
  client_user_id: string;
  staff_id: string | null;
  rating: number;
  comment: string;
  created_at: string;
  owner_reply?: string | null;
  owner_reply_at?: string | null;
};

export type FreeSlot = {
  startUtc: string; // ISO
  endUtc: string;
  labelLocal: string; // e.g. "09:30"
};

export type WaitlistStatus = 'active' | 'notified' | 'booked' | 'cancelled';

export type WaitlistEntry = {
  id: string;
  business_id: string;
  client_user_id: string;
  service_id: string | null;
  staff_id?: string | null;
  desired_date: string;
  status: WaitlistStatus;
  client_email?: string | null;
  client_phone?: string | null;
  notified_at: string | null;
  created_at: string;
};

export type BusinessClientRow = {
  business_id: string;
  client_user_id: string;
  contact: string;
  display_name: string | null;
  visit_count: number;
  last_start_at: string | null;
  upcoming_count: number;
  note: string;
  no_show_count: number;
  blocked: boolean;
};

export type ChatConversation = {
  id: string;
  business_id: string;
  client_user_id: string;
  last_message_at: string | null;
  created_at: string;
  client_last_read_at?: string | null;
  owner_last_read_at?: string | null;
};

export type PackageTemplate = {
  id: string;
  business_id: string;
  name: string;
  sessions: number;
  price: number;
  active: boolean;
  sort_order: number;
  created_at: string;
};

export type ClientPackage = {
  id: string;
  business_id: string;
  client_user_id: string;
  package_id: string;
  sessions_total: number;
  sessions_used: number;
  created_at: string;
  updated_at: string;
};

export type ClientIntake = {
  id: string;
  business_id: string;
  client_user_id: string;
  allergies: string;
  conditions: string;
  photo_consent: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type ClientPhoto = {
  id: string;
  business_id: string;
  client_user_id: string;
  /** Calea în bucket-ul privat 'client-photos' (nu un URL public). */
  storage_path: string;
  kind: 'before' | 'after';
  /** Link semnat temporar, pus doar în aplicație pentru afișare. */
  signedUrl?: string | null;
  created_at: string;
};

export type GiftCard = {
  id: string;
  business_id: string;
  code: string;
  amount: number;
  balance: number;
  recipient_name: string | null;
  status: 'active' | 'redeemed' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  body: string;
  created_at: string;
};
