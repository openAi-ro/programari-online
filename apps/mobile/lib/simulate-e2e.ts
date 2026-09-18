/**
 * Test simulat end-to-end (in-memory) pentru fluxul Programari.
 * Nu necesită Supabase, Expo sau rețea.
 *
 * Rulează: npm run test:simulate
 */

import { generateFreeSlots } from './slots';
import { generatePublicCode } from './publicCode';
import { formatInTimeZone } from './timezone';
import {
  DEFAULT_AUTO_APPROVE_RETURNING,
  DEFAULT_BREAK_HOURS,
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_CANCEL_NOTICE_MINUTES,
  DEFAULT_DEPOSIT_RON,
  DEFAULT_LOYALTY_EVERY,
  DEFAULT_MAX_ADVANCE_DAYS,
  DEFAULT_MIN_NOTICE_MINUTES,
  DEFAULT_NO_SHOW_BLOCK_AFTER,
  DEFAULT_TIMEZONE,
  DEFAULT_WORKING_HOURS,
} from './defaults';
import type {
  Appointment,
  AppointmentStatus,
  BusinessProfile,
  Profile,
} from './types';

// ─── Helpers ───────────────────────────────────────────────────────────────

type LogLevel = 'OK' | 'FAIL' | 'INFO' | 'PUSH' | 'EMAIL' | 'WA';

const logs: { level: LogLevel; msg: string }[] = [];
let passed = 0;
let failed = 0;

function log(level: LogLevel, msg: string) {
  logs.push({ level, msg });
  const prefix =
    level === 'OK'
      ? '  ✓'
      : level === 'FAIL'
        ? '  ✗'
        : level === 'INFO'
          ? '  ·'
          : `  [${level}]`;
  console.log(`${prefix} ${msg}`);
}

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
    log('OK', name + (detail ? ` — ${detail}` : ''));
  } else {
    failed++;
    log('FAIL', name + (detail ? ` — ${detail}` : ''));
  }
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nextMondayLocal(): string {
  // Fixed Monday for deterministic tests (2026-08-03 is a Monday)
  return '2026-08-03';
}

// ─── In-memory DB ──────────────────────────────────────────────────────────

const db = {
  profiles: [] as Profile[],
  businesses: [] as BusinessProfile[],
  appointments: [] as Appointment[],
  pushTokens: [] as { user_id: string; token: string }[],
  notifications: [] as {
    channel: string;
    to: string;
    subject?: string;
    text: string;
    event: string;
  }[],
  blocks: [] as { business_id: string; client_user_id: string }[],
};

function createProfile(partial: {
  email?: string | null;
  phone?: string | null;
  display_name?: string;
}): Profile | { error: string } {
  const email = partial.email ?? null;
  const phone = partial.phone ?? null;
  if (!email && !phone) {
    return { error: 'contact_required' };
  }
  const p: Profile = {
    id: uid('user'),
    email,
    phone,
    display_name: partial.display_name ?? null,
  };
  db.profiles.push(p);
  return p;
}

function createBusiness(
  owner: Profile,
  opts: {
    name: string;
    session_duration_minutes: number;
    breakEnabled?: boolean;
  }
): BusinessProfile {
  const now = new Date().toISOString();
  const b: BusinessProfile = {
    id: uid('biz'),
    owner_user_id: owner.id,
    name: opts.name,
    public_code: generatePublicCode(10),
    timezone: DEFAULT_TIMEZONE,
    session_duration_minutes: opts.session_duration_minutes,
    working_hours: { ...DEFAULT_WORKING_HOURS },
    break_hours: {
      ...DEFAULT_BREAK_HOURS,
      enabled: opts.breakEnabled ?? true,
      start: '13:00',
      end: '14:00',
    },
    min_notice_minutes: DEFAULT_MIN_NOTICE_MINUTES,
    buffer_minutes: DEFAULT_BUFFER_MINUTES,
    max_advance_days: DEFAULT_MAX_ADVANCE_DAYS,
    cancel_notice_minutes: DEFAULT_CANCEL_NOTICE_MINUTES,
    blocked_dates: [],
    deposit_ron: DEFAULT_DEPOSIT_RON,
    auto_approve_returning: DEFAULT_AUTO_APPROVE_RETURNING,
    no_show_block_after: DEFAULT_NO_SHOW_BLOCK_AFTER,
    loyalty_every: DEFAULT_LOYALTY_EVERY,
    created_at: now,
    updated_at: now,
  };
  db.businesses.push(b);
  return b;
}

function blockingStatuses(s: AppointmentStatus) {
  return s === 'pending' || s === 'approved';
}

function createAppointmentIfFree(
  business: BusinessProfile,
  client: Profile,
  startUtc: string,
  endUtc: string
): Appointment | { error: string } {
  if (!client.email && !client.phone) {
    return { error: 'contact_required' };
  }
  if (db.blocks.some((b) => b.business_id === business.id && b.client_user_id === client.id)) {
    return { error: 'client_blocked' };
  }
  const start = new Date(startUtc);
  const end = new Date(endUtc);
  if (!(end > start)) return { error: 'invalid_range' };

  const conflict = db.appointments.some(
    (a) =>
      a.business_id === business.id &&
      blockingStatuses(a.status) &&
      new Date(a.start_at) < end &&
      new Date(a.end_at) > start
  );
  if (conflict) return { error: 'slot_taken' };

  const returning = db.appointments.some(
    (a) =>
      a.business_id === business.id &&
      a.client_user_id === client.id &&
      a.status === 'approved'
  );
  const status: AppointmentStatus =
    business.auto_approve_returning && returning ? 'approved' : 'pending';
  const visits = db.appointments.filter(
    (a) =>
      a.business_id === business.id &&
      a.client_user_id === client.id &&
      a.status === 'approved' &&
      !a.no_show
  ).length;
  const loyalty =
    (business.loyalty_every ?? 0) >= 2 && (visits + 1) % business.loyalty_every === 0;
  const deposit = loyalty ? 0 : business.deposit_ron ?? 0;
  const now = new Date().toISOString();
  const row: Appointment = {
    id: uid('apt'),
    business_id: business.id,
    client_user_id: client.id,
    start_at: startUtc,
    end_at: endUtc,
    status,
    client_email: client.email,
    client_phone: client.phone,
    reminder_sent: false,
    decision_notified: false,
    payment_status: deposit > 0 ? 'unpaid' : 'none',
    deposit_ron: deposit,
    loyalty_redeemed: loyalty,
    created_at: now,
    updated_at: now,
  };
  db.appointments.push(row);

  // Push stub → business owner
  const tokens = db.pushTokens.filter((t) => t.user_id === business.owner_user_id);
  for (const t of tokens) {
    const text = `Cerere nouă la ${business.name} (${startUtc})`;
    db.notifications.push({
      channel: 'push',
      to: t.token,
      text,
      event: 'pending',
    });
    log('PUSH', `→ owner token=${t.token.slice(0, 12)}… | ${text}`);
  }

  return row;
}

function notifyClientDecision(apt: Appointment, business: BusinessProfile) {
  const when = apt.start_at;
  if (apt.status === 'approved') {
    const text = `Programarea ta la ${business.name} pe ${when} a fost confirmată.`;
    if (apt.client_email) {
      db.notifications.push({
        channel: 'email',
        to: apt.client_email,
        subject: 'Programare confirmată',
        text,
        event: 'approved',
      });
      log('EMAIL', `→ ${apt.client_email} | ${text}`);
    }
    if (apt.client_phone) {
      db.notifications.push({
        channel: 'whatsapp',
        to: apt.client_phone,
        text,
        event: 'approved',
      });
      log('WA', `→ ${apt.client_phone} | ${text}`);
    }
  } else if (apt.status === 'rejected') {
    const text = `Programarea ta la ${business.name} pe ${when} a fost respinsă. Slotul a fost eliberat.`;
    if (apt.client_email) {
      db.notifications.push({
        channel: 'email',
        to: apt.client_email,
        subject: 'Programare respinsă',
        text,
        event: 'rejected',
      });
      log('EMAIL', `→ ${apt.client_email} | ${text}`);
    }
    if (apt.client_phone) {
      db.notifications.push({
        channel: 'whatsapp',
        to: apt.client_phone,
        text,
        event: 'rejected',
      });
      log('WA', `→ ${apt.client_phone} | ${text}`);
    }
  }
  apt.decision_notified = true;
  apt.updated_at = new Date().toISOString();
}

function setStatus(
  apt: Appointment,
  status: 'approved' | 'rejected',
  business: BusinessProfile
) {
  if (apt.status !== 'pending') return { error: 'not_pending' };
  apt.status = status;
  notifyClientDecision(apt, business);
  return { ok: true };
}

function runReminders(now: Date) {
  const min = new Date(now.getTime() + 25 * 60 * 1000);
  const max = new Date(now.getTime() + 35 * 60 * 1000);
  let count = 0;
  for (const apt of db.appointments) {
    if (apt.status !== 'approved' || apt.reminder_sent) continue;
    const start = new Date(apt.start_at);
    if (start < min || start > max) continue;
    const business = db.businesses.find((b) => b.id === apt.business_id)!;
    const when = formatInTimeZone(new Date(apt.start_at), business.timezone, 'dd.MM.yyyy HH:mm');
    const text = `Salut! Ai o programare la ${business.name} în 30 de minute (${when}, ${business.timezone}).`;
    if (apt.client_email) {
      db.notifications.push({
        channel: 'email',
        to: apt.client_email,
        subject: 'Reminder programare',
        text,
        event: 'reminder_30m',
      });
      log('EMAIL', `REMINDER → ${apt.client_email} | ${text}`);
    }
    if (apt.client_phone) {
      db.notifications.push({
        channel: 'whatsapp',
        to: apt.client_phone,
        text,
        event: 'reminder_30m',
      });
      log('WA', `REMINDER → ${apt.client_phone} | ${text}`);
    }
    apt.reminder_sent = true;
    count++;
  }
  return count;
}

function expirePending(now: Date) {
  let n = 0;
  for (const apt of db.appointments) {
    if (apt.status !== 'pending') continue;
    const age = now.getTime() - new Date(apt.created_at).getTime();
    if (age >= 24 * 60 * 60 * 1000) {
      apt.status = 'cancelled';
      apt.updated_at = now.toISOString();
      n++;
    }
  }
  return n;
}

function busyForBusiness(businessId: string) {
  return db.appointments
    .filter((a) => a.business_id === businessId && blockingStatuses(a.status))
    .map((a) => ({ startUtc: a.start_at, endUtc: a.end_at }));
}

// ─── Scenario ──────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log('  PROGRAMARI — test simulat end-to-end');
console.log('══════════════════════════════════════════════\n');

// 1. Anti-anonim
console.log('1) Conturi și anti-anonim');
const anon = createProfile({ email: null, phone: null });
assert('error' in anon, 'Programare/cont anonim REFUZAT', (anon as any).error);

const owner = createProfile({
  email: 'salon@example.com',
  phone: '+40722111111',
  display_name: 'Maria Salon',
}) as Profile;
assert(!!owner.id, 'Owner creat', owner.email!);

const client = createProfile({
  email: 'client@example.com',
  phone: '+40722222222',
  display_name: 'Ion Client',
}) as Profile;
assert(!!client.id, 'Client creat', client.phone!);

const clientNoContact = {
  id: uid('user'),
  email: null,
  phone: null,
  display_name: 'Anonim',
} as Profile;

// 2. Business setup
console.log('\n2) Config business (timezone, durată, program, pauză, QR)');
const business = createBusiness(owner, {
  name: 'Salon Demo',
  session_duration_minutes: 60,
  breakEnabled: true,
});
assert(business.timezone === 'Europe/Bucharest', 'Timezone Europe/Bucharest');
assert(business.session_duration_minutes === 60, 'Durată ședință 60 min');
assert(business.break_hours.enabled === true, 'Pauză 13:00–14:00 activă');
const deepLink = `programari://b/${business.public_code}`;
assert(business.public_code.length === 10, 'public_code generat', deepLink);
log('INFO', `QR / tunel: ${deepLink}`);

db.pushTokens.push({
  user_id: owner.id,
  token: 'ExponentPushToken[SIMULATED_OWNER_DEVICE]',
});
log('INFO', 'Push token înregistrat pentru owner');

// 3. Sloturi libere (luni cu pauză)
console.log('\n3) Citire agendă — doar sloturi libere');
const dateLocal = nextMondayLocal();
let free = generateFreeSlots({
  dateLocal,
  timezone: business.timezone,
  sessionDurationMinutes: business.session_duration_minutes,
  workingHours: business.working_hours,
  breakHours: business.break_hours,
  busy: busyForBusiness(business.id),
});
// 09-17, 60min, break 13-14 → 09,10,11,12,14,15,16 = 7
assert(free.length === 7, '7 sloturi libere (fără 13:00 din cauza pauzei)', free.map((s) => s.labelLocal).join(', '));
assert(
  !free.some((s) => s.labelLocal === '13:00'),
  'Slotul 13:00 NU apare (pauză)'
);

// 4. Client anonim nu poate programa
console.log('\n4) Booking — anti-anonim + pending');
const tryAnon = createAppointmentIfFree(
  business,
  clientNoContact,
  free[0].startUtc,
  free[0].endUtc
);
assert('error' in tryAnon && tryAnon.error === 'contact_required', 'Client fără contact REFUZAT');

const slot9 = free.find((s) => s.labelLocal === '09:00')!;
const apt1 = createAppointmentIfFree(
  business,
  client,
  slot9.startUtc,
  slot9.endUtc
) as Appointment;
assert(!('error' in (apt1 as any)) && apt1.status === 'pending', 'Cerere pending creată 09:00');
assert(
  db.notifications.some((n) => n.channel === 'push' && n.event === 'pending'),
  'Push trimis către business la pending'
);

// 5. Slot ocupat pentru al doilea client
console.log('\n5) Rezervare temporară — slot blocat');
free = generateFreeSlots({
  dateLocal,
  timezone: business.timezone,
  sessionDurationMinutes: business.session_duration_minutes,
  workingHours: business.working_hours,
  breakHours: business.break_hours,
  busy: busyForBusiness(business.id),
});
assert(
  !free.some((s) => s.labelLocal === '09:00'),
  '09:00 nu mai e liber (pending blochează)'
);

const client2 = createProfile({ email: 'alt@example.com' }) as Profile;
const conflict = createAppointmentIfFree(
  business,
  client2,
  slot9.startUtc,
  slot9.endUtc
);
assert(
  'error' in conflict && conflict.error === 'slot_taken',
  'Al doilea client primește slot_taken'
);

// 6. Approve + notificări client
console.log('\n6) Business aprobă → email + WhatsApp client');
setStatus(apt1, 'approved', business);
assert(apt1.status === 'approved', 'Status approved');
assert(apt1.decision_notified === true, 'decision_notified = true');
assert(
  db.notifications.some((n) => n.event === 'approved' && n.channel === 'email'),
  'Email approve către client'
);
assert(
  db.notifications.some(
    (n) => n.event === 'approved' && n.channel === 'whatsapp'
  ),
  'WhatsApp approve către client'
);

// 7. Reject pe alt slot
console.log('\n7) A doua cerere — respingere');
const slot10 = free.find((s) => s.labelLocal === '10:00')!;
const apt2 = createAppointmentIfFree(
  business,
  client2,
  slot10.startUtc,
  slot10.endUtc
) as Appointment;
setStatus(apt2, 'rejected', business);
assert(apt2.status === 'rejected', 'Status rejected');
assert(
  db.notifications.some((n) => n.event === 'rejected' && n.channel === 'email'),
  'Email reject către client2'
);

free = generateFreeSlots({
  dateLocal,
  timezone: business.timezone,
  sessionDurationMinutes: business.session_duration_minutes,
  workingHours: business.working_hours,
  breakHours: business.break_hours,
  busy: busyForBusiness(business.id),
});
assert(
  free.some((s) => s.labelLocal === '10:00'),
  'După reject, 10:00 e din nou liber'
);

// 8. Reminder −30 min
console.log('\n8) Reminder automat −30 minute');
const soon = new Date(Date.now() + 30 * 60 * 1000);
const endSoon = new Date(soon.getTime() + 60 * 60 * 1000);
const aptReminder: Appointment = {
  id: uid('apt'),
  business_id: business.id,
  client_user_id: client.id,
  start_at: soon.toISOString(),
  end_at: endSoon.toISOString(),
  status: 'approved',
  client_email: client.email,
  client_phone: client.phone,
  reminder_sent: false,
  decision_notified: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};
db.appointments.push(aptReminder);
const reminded = runReminders(new Date());
assert(reminded === 1, 'Reminder trimis pentru 1 programare');
assert(aptReminder.reminder_sent === true, 'reminder_sent = true');
assert(
  db.notifications.filter((n) => n.event === 'reminder_30m').length >= 2,
  'Reminder pe email + WhatsApp'
);
const remindedAgain = runReminders(new Date());
assert(remindedAgain === 0, 'Reminder nu se retrimite (idempotent)');

// 9. Expirare pending 24h
console.log('\n9) Expirare pending după 24h');
const oldPending: Appointment = {
  id: uid('apt'),
  business_id: business.id,
  client_user_id: client2.id,
  start_at: free[0].startUtc,
  end_at: free[0].endUtc,
  status: 'pending',
  client_email: client2.email,
  client_phone: null,
  reminder_sent: false,
  decision_notified: false,
  created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  updated_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
};
db.appointments.push(oldPending);
const expired = expirePending(new Date());
assert(expired >= 1 && oldPending.status === 'cancelled', 'Pending vechi → cancelled');

// 10. Deep link parse simulat
console.log('\n10) Parsare tunel QR');
const match = deepLink.match(/^programari:\/\/b\/([a-z0-9]+)$/);
assert(!!match && match[1] === business.public_code, 'Deep link valid', deepLink);
const found = db.businesses.find((b) => b.public_code === match![1]);
assert(!!found, 'Business găsit după public_code din QR');

// 11. v1.3 auto-approve + blocare
console.log('\n11) Avans, auto-aprobare, blocare');
business.deposit_ron = 30;
const lateSlot = generateFreeSlots({
  dateLocal: nextMondayLocal(),
  timezone: business.timezone,
  sessionDurationMinutes: business.session_duration_minutes,
  workingHours: business.working_hours,
  breakHours: business.break_hours,
  busy: db.appointments
    .filter((a) => a.business_id === business.id && (a.status === 'pending' || a.status === 'approved'))
    .map((a) => ({ startUtc: a.start_at, endUtc: a.end_at })),
})[0];
assert(!!lateSlot, 'Mai e un slot pentru test v1.3');
const withDeposit = createAppointmentIfFree(business, client2, lateSlot.startUtc, lateSlot.endUtc);
assert(!('error' in withDeposit) && withDeposit.payment_status === 'unpaid', 'Avans 30 lei → unpaid');
assert(!('error' in withDeposit) && withDeposit.deposit_ron === 30, 'deposit_ron snapshot 30');

business.auto_approve_returning = true;
const later = generateFreeSlots({
  dateLocal: nextMondayLocal(),
  timezone: business.timezone,
  sessionDurationMinutes: business.session_duration_minutes,
  workingHours: business.working_hours,
  breakHours: business.break_hours,
  busy: db.appointments
    .filter((a) => a.business_id === business.id && (a.status === 'pending' || a.status === 'approved'))
    .map((a) => ({ startUtc: a.start_at, endUtc: a.end_at })),
})[0];
assert(!!later, 'Slot pentru client recurent');
const auto = createAppointmentIfFree(business, client, later.startUtc, later.endUtc);
assert(!('error' in auto) && auto.status === 'approved', 'Client cu vizită aprobată → auto-approved');

db.blocks.push({ business_id: business.id, client_user_id: client2.id });
const blockedTry = createAppointmentIfFree(business, client2, later.startUtc, later.endUtc);
assert('error' in blockedTry && blockedTry.error === 'client_blocked', 'Client blocat → client_blocked');

business.auto_approve_returning = false;
db.blocks = [];
const paidVisits = db.appointments.filter(
  (a) =>
    a.client_user_id === client.id &&
    a.status === 'approved' &&
    !a.no_show
).length;
assert(paidVisits >= 1, 'Client are vizite pentru loialitate');
business.loyalty_every = paidVisits + 1;
const giftSlot = generateFreeSlots({
  dateLocal: nextMondayLocal(),
  timezone: business.timezone,
  sessionDurationMinutes: business.session_duration_minutes,
  workingHours: business.working_hours,
  breakHours: business.break_hours,
  busy: db.appointments
    .filter((a) => a.business_id === business.id && (a.status === 'pending' || a.status === 'approved'))
    .map((a) => ({ startUtc: a.start_at, endUtc: a.end_at })),
})[0];
assert(!!giftSlot, 'Slot pentru loialitate');
const gift = createAppointmentIfFree(business, client, giftSlot.startUtc, giftSlot.endUtc);
assert(!('error' in gift) && gift.loyalty_redeemed === true, 'Următoarea vizită (every=N) → cadou');

// ─── Summary ───────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════');
console.log(`  REZULTAT: ${passed} passed, ${failed} failed`);
console.log(`  Notificări simulate: ${db.notifications.length}`);
console.log(`  Programări: ${db.appointments.length}`);
console.log('══════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Detalii eșecuri:');
  for (const l of logs.filter((x) => x.level === 'FAIL')) {
    console.log('  -', l.msg);
  }
  process.exit(1);
}

console.log('Toate scenariile simulate au trecut.\n');
process.exit(0);
