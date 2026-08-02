# Programari

Aplicație mobilă **Programari** (Expo / React Native) pentru programări online: business + client în aceeași app, QR tunel, aprobare pending, push, email/WhatsApp și reminder −30 min.

## Structură

```
programari online/
  apps/mobile/          # Expo app (expo-router)
  supabase/
    migrations/         # schema Postgres + RLS
    functions/          # Edge Functions (Deno)
    README.md           # webhooks, cron, secrets
  docs/superpowers/     # spec + plan
  README.md
```

## Cerințe

- Node.js 20+
- Expo CLI (`npx expo`)
- Cont [Supabase](https://supabase.com)
- Dispozitiv fizic pentru push (Expo Go OK pe device)
- Opțional: Resend (email), Twilio WhatsApp

---

## 1. App Expo

```bash
cd apps/mobile
cp .env.example .env
# editează EXPO_PUBLIC_SUPABASE_URL și EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start
```

### Variabile client (`apps/mobile/.env`)

| Variabilă | Descriere |
|-----------|-----------|
| `EXPO_PUBLIC_SUPABASE_URL` | URL proiect Supabase |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Anon/public key (RLS activ) |

Vezi `apps/mobile/.env.example`.

---

## 2. Supabase — migrare

```bash
# din rădăcina repo (CLI Supabase instalat)
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

Migrarea `supabase/migrations/20260802000000_init.sql` creează:

- `profiles`, `business_profiles`, `appointments`, `device_push_tokens`
- RLS pe toate tabelele
- RPC `create_appointment_if_free` (creare atomică pending)
- trigger profil la signup

Detalii: [supabase/README.md](./supabase/README.md).

---

## 3. Edge Functions — deploy

```bash
supabase functions deploy notify-pending-push
supabase functions deploy notify-decision
supabase functions deploy send-reminders
supabase functions deploy expire-pending
```

### Secrets (edge)

```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set EMAIL_FROM="Programari <onboarding@resend.dev>"
supabase secrets set TWILIO_ACCOUNT_SID=ACxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxx
supabase secrets set TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
supabase secrets set WEBHOOK_SECRET=<random>
supabase secrets set CRON_SECRET=<random>
```

Fără chei email/WhatsApp, funcțiile **stub-uiesc** (`console.log EMAIL_STUB` / `WHATSAPP_STUB`) — fluxul rămâne testabil.

`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` sunt injectate automat pe hosted.

---

## 4. Webhooks (Database)

În **Dashboard → Database → Webhooks**:

| Nume | Table | Event | Function |
|------|-------|-------|----------|
| appointment-insert-push | `appointments` | INSERT | `notify-pending-push` |
| appointment-decision | `appointments` | UPDATE | `notify-decision` |

Headers recomandate:

- `Authorization: Bearer <SERVICE_ROLE_KEY>`
- `x-webhook-secret: <WEBHOOK_SECRET>` (dacă e setat)

Documentație detaliată: [supabase/functions/notify-pending-push/README.md](./supabase/functions/notify-pending-push/README.md) și [supabase/README.md](./supabase/README.md).

---

## 5. Cron

| Job | Interval | Function |
|-----|----------|----------|
| Reminder −30 min | fiecare **2 minute** | `send-reminders` |
| Expire pending 24h | fiecare **60 minute** | `expire-pending` |

Exemplu invocare:

```bash
curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders" \
  -H "Authorization: Bearer <CRON_SECRET_sau_SERVICE_ROLE>"

curl -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/expire-pending" \
  -H "Authorization: Bearer <CRON_SECRET_sau_SERVICE_ROLE>"
```

Poți programa din Dashboard (Edge Function schedules) sau `pg_cron` + `pg_net` — exemple SQL în `supabase/README.md`.

**Reminder:** selectează `approved` cu `reminder_sent=false` și `start_at` între **now+25m** și **now+35m**.

**Expire:** `pending` cu `created_at < now() - 24h` → `cancelled`.

---

## 6. Navigare app (română)

| Ecran | Ruta | Rol |
|-------|------|-----|
| Autentificare | `/(auth)/login` | Email sau telefon OTP |
| Acasă | `/(app)/home` | Meniu + înregistrare push |
| Config business | `/(app)/business/setup` | Timezone, durată, program, pauză |
| QR | `/(app)/business/qr` | Cod public + QR |
| Cereri | `/(app)/business/requests` | Approve / reject (+ din push) |
| Scanează QR | `/(app)/scan` | Camera → tunel |
| Rezervare | `/(app)/book/[publicCode]` | Sloturi libere |
| Programările mele | `/(app)/my-appointments` | Status client |
| Setări | `/(app)/settings` | Contact, push, logout |
| Deep link | `programari://b/{public_code}` | Tunel QR |

Tap pe push „Cerere nouă…” → navighează la **Cereri**.

---

## 7. Smoke test checklist (manual)

1. [ ] Signup cu **email** sau **telefon** (OTP)
2. [ ] **Configurare business**: timezone, durată, program, pauză, salvare
3. [ ] Afișare **QR** + link `programari://b/...`
4. [ ] Al doilea cont: **scanează QR** → vede doar **sloturi libere**
5. [ ] Client creează programare → status **pending**
6. [ ] Business primește **push** (device fizic, permisiuni OK)
7. [ ] Tap pe push → ecran **Cereri**
8. [ ] **Approve** → client primește email/WhatsApp (sau log stub)
9. [ ] **Reject** pe altă cerere → slot eliberat + mesaj client
10. [ ] Setează o programare `approved` cu `start_at` peste ~30 min → rulează `send-reminders` → `reminder_sent=true`
11. [ ] Pending mai vechi de 24h → `expire-pending` → `cancelled`
12. [ ] **Setări**: contact afișat, reînregistrare push, deconectare

---

## 8. Auth notes

- **Email OTP:** activ implicit pe Supabase (configurează SMTP la producție).
- **Phone OTP:** necesită provider SMS (Twilio etc.) pe proiectul Supabase.
- Anti-anonim: constraint pe `profiles` + RPC refuză programări fără email/telefon.

---

## Licență

Vezi `apps/mobile/LICENSE` (template Expo).
