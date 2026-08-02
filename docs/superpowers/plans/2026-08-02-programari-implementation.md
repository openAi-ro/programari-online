# Programari — Plan de implementare

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicație mobilă Expo **Programari** (Android + iOS) cu cont business/client, QR tunel către agenda liberă, programări pending cu aprobare, anti-anonim (email sau telefon), timezone pe business, push la pending, email/WhatsApp la approve/reject și reminder la −30 min.

**Architecture:** Client Expo (React Native + TypeScript) vorbește cu Supabase (Auth, Postgres, RLS, Edge Functions, Cron). Sloturile se calculează din programul de lucru, pauză, durata ședinței și programările `pending`/`approved`, în timezone-ul business-ului; `start_at`/`end_at` se stochează UTC. Notificările: Expo Push (business), email + WhatsApp (client).

**Tech Stack:** Expo SDK 52+, expo-router, TypeScript, @supabase/supabase-js, expo-notifications, expo-camera (QR), react-native-qrcode-svg, date-fns-tz, Supabase Edge Functions (Deno), Resend (email), Twilio sau Meta Cloud API (WhatsApp — stub + env dacă lipsesc cheile).

**Spec:** `docs/superpowers/specs/2026-08-02-programari-design.md`

## Global Constraints

- Nume app afișat: **Programari**
- Fără programări anonime: cont cu **email SAU telefon** obligatoriu; validare și server-side
- Statusuri: `pending` | `approved` | `rejected` | `cancelled`
- Slot ocupat de `pending` și `approved`
- Pending expiră după **24h** → `cancelled`
- Reminder doar pe `approved`, fereastră **25–35 min** înainte de `start_at`
- Timezone business IANA obligatoriu (default `Europe/Bucharest`)
- Push la INSERT `pending` către owner business
- Email/WhatsApp la tranziție `pending` → `approved`/`rejected` (o dată, `decision_notified`)
- Răspunsuri UI și mesaje utilizator în **română**
- Cod sursă / identificatori în engleză
- Proiect rădăcină: `C:\Users\Administrator\Desktop\programari online`

---

## File structure (țintă)

```
programari online/
  apps/mobile/                    # Expo app
    app/                          # expo-router screens
      _layout.tsx
      index.tsx                   # home / redirect
      (auth)/login.tsx
      (app)/_layout.tsx
      (app)/home.tsx
      (app)/business/setup.tsx
      (app)/business/qr.tsx
      (app)/business/requests.tsx
      (app)/book/[publicCode].tsx
      (app)/my-appointments.tsx
      (app)/settings.tsx
    lib/
      supabase.ts
      auth.ts
      slots.ts                    # pure slot calculation
      timezone.ts
      notifications.ts            # register push token
      types.ts
    components/
      SlotPicker.tsx
      WorkingHoursForm.tsx
      AppointmentCard.tsx
    package.json
    app.json
  supabase/
    config.toml
    migrations/20260802000000_init.sql
    functions/
      notify-pending-push/index.ts
      notify-decision/index.ts
      send-reminders/index.ts
      expire-pending/index.ts
  packages/shared/                # optional: types + slots shared
    slots.ts
    types.ts
  README.md
  docs/superpowers/specs/...
  docs/superpowers/plans/...
```

---

### Task 1: Scaffold Expo + monorepo layout

**Files:**
- Create: `apps/mobile/` (via `npx create-expo-app`)
- Create: `README.md`
- Create: `apps/mobile/app.json` (name Programari)
- Create: `apps/mobile/lib/types.ts`

**Interfaces:**
- Produces: Expo app rulează; tipuri TypeScript de bază exportate din `types.ts`

- [ ] **Step 1: Creează app Expo cu TypeScript + expo-router**

```bash
cd "C:\Users\Administrator\Desktop\programari online"
npx create-expo-app@latest apps/mobile -t tabs
```

Dacă template-ul diferă, configurează `expo-router` conform documentației Expo Router (entry `expo-router/entry`).

- [ ] **Step 2: Setează numele aplicației**

În `apps/mobile/app.json` / `app.config.js`:

```json
{
  "expo": {
    "name": "Programari",
    "slug": "programari",
    "scheme": "programari",
    "orientation": "portrait",
    "ios": { "bundleIdentifier": "com.programari.app" },
    "android": { "package": "com.programari.app" },
    "plugins": [
      "expo-router",
      "expo-notifications",
      [
        "expo-camera",
        { "cameraPermission": "Permite scanarea QR pentru programări." }
      ]
    ]
  }
}
```

- [ ] **Step 3: Adaugă tipurile de domeniu**

`apps/mobile/lib/types.ts`:

```typescript
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
```

- [ ] **Step 4: README rădăcină**

`README.md` cu: ce e app-ul, `cd apps/mobile && npx expo start`, nevoie de proiect Supabase, variabile `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile README.md
git commit -m "chore: scaffold Expo app Programari"
```

---

### Task 2: Schema Supabase + RLS

**Files:**
- Create: `supabase/migrations/20260802000000_init.sql`
- Create: `supabase/config.toml` (via `supabase init` dacă CLI e disponibil)

**Interfaces:**
- Produces: tabele `profiles`, `business_profiles`, `appointments`, `device_push_tokens`; RLS; RPC `create_appointment_if_free`

- [ ] **Step 1: Migration SQL**

`supabase/migrations/20260802000000_init.sql`:

```sql
-- profiles (1:1 auth.users)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text,
  display_name text,
  created_at timestamptz not null default now(),
  constraint profiles_contact_chk check (email is not null or phone is not null)
);

create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  public_code text not null unique,
  timezone text not null default 'Europe/Bucharest',
  session_duration_minutes int not null check (session_duration_minutes between 5 and 480),
  working_hours jsonb not null,
  break_hours jsonb not null default '{"enabled":false,"start":"13:00","end":"14:00"}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_profiles_owner_idx on public.business_profiles(owner_user_id);
create index business_profiles_public_code_idx on public.business_profiles(public_code);

create type public.appointment_status as enum ('pending','approved','rejected','cancelled');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.business_profiles(id) on delete cascade,
  client_user_id uuid not null references public.profiles(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.appointment_status not null default 'pending',
  client_email text,
  client_phone text,
  reminder_sent boolean not null default false,
  decision_notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_contact_chk check (client_email is not null or client_phone is not null),
  constraint appointments_range_chk check (end_at > start_at)
);

create index appointments_business_time_idx on public.appointments(business_id, start_at, end_at);
create index appointments_client_idx on public.appointments(client_user_id);
create index appointments_reminder_idx on public.appointments(status, reminder_sent, start_at);

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios','android')),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

-- overlap helper: active statuses that block a slot
create or replace function public.appointment_blocks_slot(s public.appointment_status)
returns boolean language sql immutable as $$
  select s in ('pending','approved');
$$;

-- atomic create if free + contact present
create or replace function public.create_appointment_if_free(
  p_business_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
) returns public.appointments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_phone text;
  v_row public.appointments;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;

  select email, phone into v_email, v_phone from public.profiles where id = v_user;
  if v_email is null and v_phone is null then
    raise exception 'contact_required';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'invalid_range';
  end if;

  -- lock competing rows for this business in range
  perform 1 from public.appointments
  where business_id = p_business_id
    and public.appointment_blocks_slot(status)
    and start_at < p_end_at
    and end_at > p_start_at
  for update;

  if exists (
    select 1 from public.appointments
    where business_id = p_business_id
      and public.appointment_blocks_slot(status)
      and start_at < p_end_at
      and end_at > p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.appointments (
    business_id, client_user_id, start_at, end_at, status, client_email, client_phone
  ) values (
    p_business_id, v_user, p_start_at, p_end_at, 'pending', v_email, v_phone
  ) returning * into v_row;

  return v_row;
end;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.business_profiles enable row level security;
alter table public.appointments enable row level security;
alter table public.device_push_tokens enable row level security;

create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update using (auth.uid() = id);
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);

create policy business_select_authenticated on public.business_profiles
  for select to authenticated using (true);
create policy business_insert_owner on public.business_profiles
  for insert with check (auth.uid() = owner_user_id);
create policy business_update_owner on public.business_profiles
  for update using (auth.uid() = owner_user_id);

create policy appointments_select_participant on public.appointments for select using (
  auth.uid() = client_user_id
  or auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id)
);
create policy appointments_update_owner on public.appointments for update using (
  auth.uid() in (select owner_user_id from public.business_profiles b where b.id = business_id)
);
-- inserts only via RPC create_appointment_if_free (security definer)

create policy push_tokens_own on public.device_push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trigger: new user -> profile (email/phone from auth)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, phone, display_name)
  values (
    new.id,
    new.email,
    new.phone,
    coalesce(new.raw_user_meta_data->>'display_name', null)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Aplică migration**

```bash
# cu Supabase CLI + proiect legat, SAU rulează SQL în SQL Editor din dashboard
supabase db push
```

Dacă CLI lipsește: utilizatorul lipește SQL-ul în Supabase Dashboard → SQL Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase
git commit -m "feat(db): schema profiles, business, appointments, RLS, create_appointment_if_free"
```

---

### Task 3: Client Supabase + Auth (email sau telefon)

**Files:**
- Create: `apps/mobile/lib/supabase.ts`
- Create: `apps/mobile/lib/auth.ts`
- Create: `apps/mobile/app/(auth)/login.tsx`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**
- Produces: `supabase` client; `signInWithEmail`, `signInWithPhone`, `signOut`, `getSession`
- Consumes: env `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

- [ ] **Step 1: Client Supabase**

```typescript
// apps/mobile/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anon, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 2: Instalare deps**

```bash
cd apps/mobile
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage
```

- [ ] **Step 3: Ecran login (română)**

Flux:
1. Utilizator alege **Email** sau **Telefon**
2. Introdu valoarea + OTP / magic link (email OTP sau phone OTP Supabase)
3. La lipsă contact → mesaj: „Introdu email sau telefon pentru a continua.”

```typescript
// pseudologic auth.ts
export async function sendEmailOtp(email: string) {
  return supabase.auth.signInWithOtp({ email });
}
export async function sendPhoneOtp(phone: string) {
  // phone E.164 e.g. +40722123456
  return supabase.auth.signInWithOtp({ phone });
}
export async function verifyOtp(params: {
  email?: string;
  phone?: string;
  token: string;
  type: 'email' | 'sms';
}) {
  return supabase.auth.verifyOtp(params as any);
}
```

- [ ] **Step 4: Guard sesiune în root layout**

Dacă nu e sesiune → `/(auth)/login`; altfel `/(app)/home`.

- [ ] **Step 5: Test manual**

1. Pornește Expo
2. Login cu email de test (sau phone dacă SMS e configurat)
3. Verifică rând în `profiles` cu email/phone

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(auth): login email sau telefon cu Supabase OTP"
```

---

### Task 4: Calcul sloturi libere (pure function + teste)

**Files:**
- Create: `apps/mobile/lib/slots.ts`
- Create: `apps/mobile/lib/timezone.ts`
- Create: `apps/mobile/lib/slots.test.ts` (jest sau vitest; dacă nu e test runner, folosește un script node simplu)

**Interfaces:**
- Produces:
  - `generateFreeSlots(input): FreeSlot[]`
  - Input: `{ dateLocal: string /* YYYY-MM-DD */, timezone, sessionDurationMinutes, workingHours, breakHours, busy: {startUtc,endUtc}[] }`

- [ ] **Step 1: Instalare date-fns + date-fns-tz**

```bash
cd apps/mobile
npm install date-fns date-fns-tz
```

- [ ] **Step 2: Implementează `generateFreeSlots`**

Algoritm (conform spec §8):
1. Map `dateLocal` + day-of-week → `working_hours[day]`
2. Dacă `closed` → `[]`
3. Construiește timeline local `start`→`end` cu pași `sessionDurationMinutes`
4. Exclude intervale care se suprapun cu break (dacă `enabled`)
5. Convertește fiecare slot la UTC; exclude dacă se suprapune cu orice `busy` (`pending`/`approved`)
6. Returnează `{ startUtc, endUtc, labelLocal }`

```typescript
export function rangesOverlap(
  aStart: Date, aEnd: Date, bStart: Date, bEnd: Date
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
```

- [ ] **Step 3: Teste minime**

Cazuri:
1. Luni 09–12, durată 60, fără busy, fără break → 3 sloturi
2. Break 10–11 → sloturile care se suprapun dispar
3. Busy pe 09:00–10:00 UTC corespunzător → primul slot dispare
4. Zi `closed` → `[]`

- [ ] **Step 4: Rulează teste — așteptat PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: generateFreeSlots with timezone and breaks"
```

---

### Task 5: Configurare business + QR

**Files:**
- Create: `apps/mobile/app/(app)/business/setup.tsx`
- Create: `apps/mobile/app/(app)/business/qr.tsx`
- Create: `apps/mobile/components/WorkingHoursForm.tsx`
- Create: `apps/mobile/lib/publicCode.ts`

**Interfaces:**
- Produces: insert/update `business_profiles`; ecran QR cu `programari://b/{public_code}`

- [ ] **Step 1: Generator `public_code`**

```typescript
// lib/publicCode.ts
export function generatePublicCode(length = 10): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
```

- [ ] **Step 2: Form setup (ordine UI)**

1. Timezone (default `Europe/Bucharest`)
2. Nume business
3. Durată ședință (minute)
4. Program de lucru pe zile
5. Pauză opțională (toggle + start/end)
6. Salvare → upsert `business_profiles` cu `owner_user_id = auth.uid()`, `public_code` generat dacă e creare

- [ ] **Step 3: Ecran QR**

```tsx
import QRCode from 'react-native-qrcode-svg';
const deepLink = `programari://b/${business.public_code}`;
// <QRCode value={deepLink} size={220} />
// Share + afișare link text
```

```bash
npx expo install react-native-qrcode-svg react-native-svg
```

- [ ] **Step 4: Test manual** — creează business, vezi QR, row în DB cu timezone

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(business): setup timezone, hours, break, QR"
```

---

### Task 6: Deep link + booking client (sloturi + create pending)

**Files:**
- Create: `apps/mobile/app/(app)/book/[publicCode].tsx`
- Create: `apps/mobile/components/SlotPicker.tsx`
- Modify: `apps/mobile/app/_layout.tsx` (linking)
- Create: `apps/mobile/app/(app)/scan.tsx` (camera QR)

**Interfaces:**
- Consumes: `generateFreeSlots`, RPC `create_appointment_if_free`
- Produces: navigare `programari://b/:publicCode` → ecran booking

- [ ] **Step 1: Linking config**

```js
// app.json scheme already "programari"
// Linking: programari://b/abc123 → /book/abc123
```

- [ ] **Step 2: Scan QR**

Cu `expo-camera` / `expo-barcode-scanner` (API curent Expo): la detectare `programari://b/CODE` sau URL cu `/b/CODE` → `router.push(/book/CODE)`.

- [ ] **Step 3: Ecran book**

1. Load business by `public_code`
2. Alege dată (zi)
3. Load appointments blocking (`status in pending,approved`) pentru acea zi (query pe interval UTC al zilei în timezone business)
4. `generateFreeSlots(...)`
5. Pe select slot: apelează

```typescript
const { data, error } = await supabase.rpc('create_appointment_if_free', {
  p_business_id: business.id,
  p_start_at: slot.startUtc,
  p_end_at: slot.endUtc,
});
// error messages map:
// contact_required → "Contul trebuie să aibă email sau telefon."
// slot_taken → "Slotul tocmai a fost rezervat. Alege altul."
```

6. Succes → „Cererea a fost trimisă. Așteaptă confirmarea.”

- [ ] **Step 4: Test** — două conturi: client rezervă, slot dispare din listă

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(booking): QR tunnel, free slots, pending create"
```

---

### Task 7: Cereri business (approve / reject) + lista client

**Files:**
- Create: `apps/mobile/app/(app)/business/requests.tsx`
- Create: `apps/mobile/app/(app)/my-appointments.tsx`
- Create: `apps/mobile/components/AppointmentCard.tsx`

**Interfaces:**
- Produces: update `status` la `approved`/`rejected` (owner only via RLS)

- [ ] **Step 1: Lista cereri owner**

Query appointments join business where `owner_user_id = me`, sort `created_at desc`, filtre pe status.

Buton **Aprobă** / **Respinge** pe `pending`:

```typescript
await supabase.from('appointments').update({
  status: 'approved', // or rejected
  updated_at: new Date().toISOString(),
}).eq('id', id).eq('status', 'pending');
```

- [ ] **Step 2: Programările mele (client)**

Listează `client_user_id = me` cu status vizibil în română: În așteptare / Confirmată / Respinsă / Anulată.

- [ ] **Step 3: Home**

Butonuri: Config business / QR / Cereri / Scanează / Programările mele / Setări.

- [ ] **Step 4: Test approve/reject** — slot respins reapare liber

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: business approve/reject and client appointment list"
```

---

### Task 8: Push la pending (business)

**Files:**
- Create: `apps/mobile/lib/notifications.ts`
- Create: `supabase/functions/notify-pending-push/index.ts`
- Modify: migration trigger sau Database Webhook pe INSERT appointments

**Interfaces:**
- Produces: salvare `device_push_tokens`; edge function trimite Expo Push

- [ ] **Step 1: Înregistrare token pe device (owner)**

```typescript
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

export async function registerForPushAsync(userId: string) {
  if (!Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  await supabase.from('device_push_tokens').upsert({
    user_id: userId,
    expo_push_token: token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,expo_push_token' });
  return token;
}
```

Apelează după login pe home și pe ecran business.

- [ ] **Step 2: Edge Function `notify-pending-push`**

La payload INSERT appointment:
1. Găsește `business_profiles.owner_user_id`
2. Load tokens
3. POST `https://exp.host/--/api/v2/push/send` body:

```json
[{
  "to": "ExponentPushToken[...]",
  "title": "Cerere nouă de programare",
  "body": "Ai o cerere pending. Deschide Cereri pentru a răspunde.",
  "data": { "screen": "requests", "appointmentId": "..." }
}]
```

4. Șterge token-uri cu DeviceNotRegistered

- [ ] **Step 3: Wire trigger**

Opțiuni (alege una):
- Supabase Database Webhook → edge function pe INSERT `appointments`
- Sau trigger `pg_net` / `supabase_functions.http_request`

- [ ] **Step 4: Test** pe device fizic (push nu merge pe emulator uneori)

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: push notification on pending appointment"
```

---

### Task 9: Email/WhatsApp la approve/reject + reminder −30 min + expire 24h

**Files:**
- Create: `supabase/functions/notify-decision/index.ts`
- Create: `supabase/functions/send-reminders/index.ts`
- Create: `supabase/functions/expire-pending/index.ts`
- Create: `supabase/functions/_shared/notify.ts` (sendEmail, sendWhatsApp)

**Interfaces:**
- Produces: notificări client; cron reminder; expire pending

- [ ] **Step 1: Shared senders**

```typescript
// _shared/notify.ts
export async function sendEmail(to: string, subject: string, text: string) {
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    console.log('EMAIL_STUB', { to, subject, text });
    return { ok: true, stub: true };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: Deno.env.get('EMAIL_FROM') ?? 'Programari <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
    }),
  });
  return { ok: res.ok, status: res.status };
}

export async function sendWhatsApp(toE164: string, text: string) {
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');
  const from = Deno.env.get('TWILIO_WHATSAPP_FROM'); // e.g. whatsapp:+14155238886
  if (!sid || !token || !from) {
    console.log('WHATSAPP_STUB', { toE164, text });
    return { ok: true, stub: true };
  }
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${toE164}`,
    Body: text,
  });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${sid}:${token}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    }
  );
  return { ok: res.ok, status: res.status };
}

export async function notifyClientChannels(opts: {
  email: string | null;
  phone: string | null;
  subject: string;
  text: string;
}) {
  const results = [];
  if (opts.email) results.push(await sendEmail(opts.email, opts.subject, opts.text));
  if (opts.phone) results.push(await sendWhatsApp(opts.phone, opts.text));
  return results;
}
```

- [ ] **Step 2: `notify-decision`**

Webhook pe UPDATE appointments când `status` devine `approved` sau `rejected` și `decision_notified = false`:
- Mesaje RO conform spec
- Apoi `update decision_notified = true`

- [ ] **Step 3: `send-reminders` (cron 1–5 min)**

```sql
-- logic in function with service role:
select * from appointments
where status = 'approved'
  and reminder_sent = false
  and start_at between now() + interval '25 minutes' and now() + interval '35 minutes';
```

Trimite email/WhatsApp; set `reminder_sent = true`.

- [ ] **Step 4: `expire-pending` (cron hourly)**

```sql
update appointments
set status = 'cancelled', updated_at = now()
where status = 'pending'
  and created_at < now() - interval '24 hours';
```

- [ ] **Step 5: Programează cron în `supabase/config.toml` sau Dashboard**

```
send-reminders: every 2 minutes
expire-pending: every 60 minutes
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat: decision notify, 30m reminder, expire pending 24h"
```

---

### Task 10: Polish UI, setări, deep link din push, README final

**Files:**
- Create: `apps/mobile/app/(app)/settings.tsx`
- Modify: home, navigation, error strings RO
- Modify: `README.md`

**Interfaces:**
- Produces: app MVP navigabilă end-to-end cu documentație env

- [ ] **Step 1: Setări** — afișează email/telefon profil; logout; reînregistrează push

- [ ] **Step 2: Handler notificare push** — la tap, `router.push('/business/requests')`

- [ ] **Step 3: Validări UX**
  - Business fără setup → CTA „Configurează agenda”
  - Client fără contact pe profil → blochează booking cu mesaj clar

- [ ] **Step 4: README env**

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
# Edge secrets:
RESEND_API_KEY=
EMAIL_FROM=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 5: Smoke test checklist (manual)**

1. Signup email/phone  
2. Setup business + timezone + hours + break + QR  
3. Alt cont scanează QR → doar sloturi libere  
4. Pending → push business  
5. Approve → email/WhatsApp client (sau stub logs)  
6. Reject → slot liber + mesaj client  
7. Reminder: setează appointment approved cu start_at peste ~30 min → rulează function  
8. Pending vechi 24h → cancelled  

- [ ] **Step 6: Commit final**

```bash
git commit -am "feat: settings, push deep link, README — MVP Programari"
```

---

## Spec coverage checklist

| Cerință spec | Task |
|--------------|------|
| Expo Android+iOS, nume Programari | 1 |
| Auth email SAU telefon, anti-anonim | 3, 2 (CHK), 6 (RPC) |
| Business: timezone, durată, program, pauză, QR | 5 |
| Sloturi libere + UTC/timezone | 4, 6 |
| Pending rezervă slot; approve/reject | 6, 7 |
| Push la pending | 8 |
| Email/WhatsApp approve/reject | 9 |
| Reminder −30 min | 9 |
| Expire pending 24h | 9 |
| RLS / securitate de bază | 2 |
| Deep link / tunel QR | 6 |

## Note execuție

- Fără chei Resend/Twilio: stub-urile loghează mesajele; fluxul app rămâne testabil.
- Push necesită build pe device (Expo Go suportă Expo push tokens).
- Phone OTP Supabase necesită provider SMS configurat; pentru dev rapid se poate folosi doar email OTP + câmp phone pe profil completat manual în Setări (dacă se extinde).

---

## Execution handoff

Plan salvat în `docs/superpowers/plans/2026-08-02-programari-implementation.md`.

**Două opțiuni de execuție:**

1. **Subagent-Driven (recomandat)** — un subagent per task, review între task-uri  
2. **Inline Execution** — execuție în această sesiune, cu checkpoint-uri  

**Care abordare preferi?**
```
