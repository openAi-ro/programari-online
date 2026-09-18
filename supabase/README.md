# Supabase — Programari

## Migrări

```bash
# din rădăcina proiectului
supabase link --project-ref <PROJECT_REF>
supabase db push
# sau
supabase migration up
```

Fișier: `migrations/20260802000000_init.sql`  
Tabele: `profiles`, `business_profiles`, `appointments`, `device_push_tokens`  
RPC: `create_appointment_if_free`

v1.1: `migrations/20260914000000_v11_services_booking_rules.sql` — servicii, reguli, anulare/reprogramare, prezență  
v1.2: `migrations/20260914120000_v12_public_waitlist_clients.sql` — pagină publică `/b/{code}`, waitlist, note clienți  
v1.3: `migrations/20260914150000_v13_payments_noshow.sql` — avans, no-show, blocare, auto-aprobare recurenți  
v2: `migrations/20260914180000_v2_staff_reviews_loyalty.sql` — echipă, recenzii, loialitate, rapoarte

## Edge Functions

| Function | Trigger | Rol |
|----------|---------|-----|
| `notify-pending-push` | Webhook INSERT `appointments` | Push Expo → owner business |
| `notify-decision` | Webhook UPDATE `appointments` (approved/rejected) | Email/WhatsApp client + `decision_notified` |
| `notify-waitlist` | App (JWT) la anulare / respingere | Email/WhatsApp clienți pe lista de așteptare |
| `create-deposit-checkout` | App (JWT) | Stripe Checkout pentru avans |
| `stripe-webhook` | Stripe | Marchează avansul ca plătit |
| `refund-deposit` | App (JWT) la anulare/respingere | Restituie avansul Stripe sau local |
| `send-reminders` | Cron ~2 min | Reminder −30 min (fereastră 25–35 min) + 24h |
| `expire-pending` | Cron ~60 min | Pending > 24h → `cancelled` |
| `test-whatsapp` | App Setări (JWT) | Mesaj test WhatsApp către telefonul din profil |

### Deploy

```bash
supabase functions deploy notify-pending-push
supabase functions deploy notify-decision
supabase functions deploy send-reminders
supabase functions deploy expire-pending
supabase functions deploy notify-waitlist
supabase functions deploy create-deposit-checkout
supabase functions deploy refund-deposit
supabase functions deploy stripe-webhook --no-verify-jwt
supabase functions deploy test-whatsapp
supabase functions deploy auth-whatsapp-otp --no-verify-jwt
supabase functions deploy auth-whatsapp-verify --no-verify-jwt
```

### Secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxx
supabase secrets set EMAIL_FROM="Programari <onboarding@resend.dev>"

# Meta WhatsApp Cloud API (recomandat)
supabase secrets set WHATSAPP_PROVIDER=meta
supabase secrets set WHATSAPP_ACCESS_TOKEN=EAAxxxx
supabase secrets set WHATSAPP_PHONE_NUMBER_ID=123456789
# OTP login (obligatoriu în afara ferestrei 24h — șablon aprobat)
# supabase secrets set WHATSAPP_OTP_TEMPLATE=programari_otp
# supabase secrets set WHATSAPP_OTP_TEMPLATE_LANG=ro
# supabase secrets set WHATSAPP_OTP_BUTTON_TYPE=url

# Twilio (alternativ)
# supabase secrets set WHATSAPP_PROVIDER=twilio
# supabase secrets set TWILIO_ACCOUNT_SID=ACxxx
# supabase secrets set TWILIO_AUTH_TOKEN=xxx
# supabase secrets set TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
# supabase secrets set TWILIO_WHATSAPP_CONTENT_SID=HXxxxxxxxx

# Deploy OTP fără JWT (login de pe ecranul de autentificare):
# supabase functions deploy auth-whatsapp-otp --no-verify-jwt
# supabase functions deploy auth-whatsapp-verify --no-verify-jwt
# supabase functions deploy test-whatsapp

supabase secrets set WEBHOOK_SECRET=random-long-string
supabase secrets set CRON_SECRET=random-long-string

# Avans Stripe (opțional). Fără ele, business-ul marchează cash/transfer.
# supabase secrets set STRIPE_SECRET_KEY=sk_test_...
# supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Fără `RESEND_API_KEY` / WhatsApp: funcțiile loghează `EMAIL_STUB` / `WHATSAPP_STUB` (flux testabil din app).

`SUPABASE_URL` și `SUPABASE_SERVICE_ROLE_KEY` sunt disponibile automat pe hosted Edge Functions.

## Database Webhooks

### 1. Push la pending

- **Table:** `appointments`
- **Events:** `INSERT`
- **URL:** `https://<PROJECT_REF>.supabase.co/functions/v1/notify-pending-push`
- **Headers:**
  - `Authorization: Bearer <SERVICE_ROLE_KEY>`
  - `x-webhook-secret: <WEBHOOK_SECRET>` (dacă e setat)

### 2. Decizie approve/reject

- **Table:** `appointments`
- **Events:** `UPDATE`
- **URL:** `https://<PROJECT_REF>.supabase.co/functions/v1/notify-decision`
- **Headers:** la fel ca mai sus
- Funcția ignoră update-uri care nu sunt `approved`/`rejected` sau au deja `decision_notified=true`.

## Cron (Dashboard → Edge Functions → Schedules, sau pg_cron + net)

### send-reminders — la fiecare 2 minute

```
GET/POST https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders
Authorization: Bearer <CRON_SECRET sau SERVICE_ROLE_KEY>
```

Logică:

```sql
-- echivalent (implementat în Edge Function cu service role)
select * from appointments
where status = 'approved'
  and reminder_sent = false
  and start_at between now() + interval '25 minutes'
                   and now() + interval '35 minutes';
```

### expire-pending — la fiecare 60 minute

```
GET/POST https://<PROJECT_REF>.supabase.co/functions/v1/expire-pending
Authorization: Bearer <CRON_SECRET sau SERVICE_ROLE_KEY>
```

Logică:

```sql
update appointments
set status = 'cancelled', updated_at = now()
where status = 'pending'
  and created_at < now() - interval '24 hours';
```

### Exemplu pg_cron + pg_net (opțional pe proiect)

```sql
-- necesită extensii pg_cron, pg_net
select cron.schedule(
  'send-reminders',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || '<SERVICE_ROLE_OR_CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'expire-pending',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/expire-pending',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || '<SERVICE_ROLE_OR_CRON_SECRET>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Mesaje client (română)

| Eveniment | Text |
|-----------|------|
| Aprobat | Programarea ta la [business] pe [dată/oră] a fost confirmată. |
| Respins | Programarea ta la [business] pe [dată/oră] a fost respinsă. Slotul a fost eliberat. |
| Reminder | Salut! Ai o programare la [business] în 30 de minute ([oră], [timezone]). |
