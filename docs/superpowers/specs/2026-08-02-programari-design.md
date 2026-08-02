# Specificație design — Programari

**Data:** 2026-08-02  
**Locație proiect:** `C:\Users\Administrator\Desktop\programari online`  
**Status:** aprobat conceptual de utilizator (arhitectură, ecrane, date)

---

## 1. Scop

Aplicație mobilă **Programari** pentru **Android și iPhone**, cu roluri **business** și **client** în aceeași aplicație.

- Business-ul își configurează agenda, generează un **QR code** (tunel de conectare).
- Clientul scanează QR-ul, vede **doar sloturile libere** și cere o programare.
- **Fără programări anonime:** obligatoriu **email sau telefon** pe cont.
- Programările trec prin **aprobare business** (pending → approved/rejected).
- Cu **30 de minute** înainte de o programare **aprobată**, se trimite **automat** mesaj pe **WhatsApp** și/sau **email**.
- La cerere **pending**, business-ul primește **push notification**.
- La **approve/reject**, clientul primește **email și/sau WhatsApp**.
- Fiecare business are **timezone** propriu (orele din program și sloturi se interpretează în acel fus orar).

---

## 2. Decizii de produs

| Decizie | Alegere |
|--------|---------|
| Roluri | Ambele în aceeași app (business + client) |
| Creare cont business | Oricine se poate înregistra |
| Alegere slot | Doar zile/ore libere din agenda calculată |
| Config business | Mai întâi durata ședinței, apoi program de lucru, pauză opțională, timezone |
| Confirmare | Pending până la aprobare/respingere; slot rezervat temporar |
| Identitate | Email SAU telefon obligatoriu; zero anonim |
| Reminder | Automat la start − 30 min, pe canalele disponibile (email/WhatsApp) |
| Push business | La fiecare cerere nouă `pending` |
| Notificare client | Email/WhatsApp la `approved` și la `rejected` |
| Timezone | Obligatoriu pe profilul business (ex. `Europe/Bucharest`) |
| Stack | Expo (React Native) + Supabase (Auth + DB + job-uri) |

---

## 3. Arhitectură

```
[App Expo Android/iOS]
        |
        | Auth + API + push token (Expo Notifications)
        v
[Supabase]
  - Auth (email / telefon OTP)
  - Postgres (utilizatori, business, programări, device tokens)
  - Edge Functions / Cron (reminder 30 min, expirare pending)
  - Trigger / Edge Function pe insert pending → push către business
  - Trigger / Edge Function pe update status → email/WhatsApp client
        |
        +-- Expo Push Service (notificări mobile business)
        +-- Email provider (ex. Resend / SMTP)
        +-- WhatsApp Business API (ex. Twilio / Meta Cloud API)
```

**Tunel QR:** deep link de forma `programari://b/<public_code>` (+ link HTTPS de rezervă pentru deschidere app).  
QR-ul conține **doar** codul public al business-ului, nu secrete.

---

## 4. Roluri și fluxuri

### 4.1 Autentificare
1. Utilizatorul se înregistrează / autentifică cu **email SAU telefon**.
2. Fără cel puțin unul din cele două → nu poate finaliza contul și nu poate crea programări.
3. Același cont poate fi business și/sau client.

### 4.2 Business — configurare (ordine fixă)
1. Setează **timezone** (implicit propus: `Europe/Bucharest`, selectabil).
2. Setează **durata ședinței** (minute).
3. Setează **programul de lucru** (zile + interval orar, interpretat în timezone-ul business).
4. Opțional: **program de pauză** (interval exclus din sloturi, același timezone).
5. Salvează profilul → se generează **cod public**, **QR** și link de partajare.
6. Permite notificări push pe dispozitiv (token salvat pentru owner).
7. Vede cereri pending; **aprobă** sau **respinge**.

### 4.3 Client — programare
1. Scanează QR sau deschide linkul tunel.
2. App citește agenda business-ului și afișează **doar sloturi libere** (ore afișate în timezone-ul business-ului).
3. Clientul alege zi + oră liberă.
4. Sistemul verifică din nou contactul (email/telefon); refuză dacă lipsește.
5. Creează programare `pending`; slotul devine indisponibil pentru alții.
6. **Business-ul primește push** imediat: „Cerere nouă de programare…”.
7. Așteaptă `approved` sau `rejected`.
8. La decizie: clientul primește **email și/sau WhatsApp** cu rezultatul.

### 4.4 Notificări pe evenimente

| Eveniment | Destinatar | Canal |
|-----------|------------|--------|
| Programare creată (`pending`) | Owner business | **Push** (Expo Notifications) |
| Status → `approved` | Client | **Email** și/sau **WhatsApp** |
| Status → `rejected` | Client | **Email** și/sau **WhatsApp** |
| `start_at − 30 min` (doar `approved`) | Client | **Email** și/sau **WhatsApp** |

**Push (business — pending):**
- Text tip: *„Cerere nouă: [Client/contact] pentru [zi] la [oră] ([timezone]).”*
- Tap pe notificare → ecranul **Cereri** (detaliu programare).
- Token-urile push se salvează per dispozitiv al owner-ului; se pot avea mai multe dispozitive.
- Dacă push e dezactivat / fără token → evenimentul rămâne vizibil doar în app (lista cereri).

**Email/WhatsApp la approve/reject (client):**
- Aprobat: *„Programarea ta la [Nume business] pe [dată/oră timezone] a fost confirmată.”*
- Respins: *„Programarea ta la [Nume business] pe [dată/oră timezone] a fost respinsă. Slotul a fost eliberat.”*
- Canale: email dacă există, WhatsApp dacă există telefon; ambele dacă ambele există.
- Se trimit o singură dată per tranziție de status (idempotent: flag-uri sau log).

### 4.5 Reminder automat (−30 min)
- Se aplică doar programărilor cu status **`approved`**.
- Momentul se calculează față de `start_at` (stocat în **UTC**); fereastra cron folosește UTC.
- La momentul `start_at - 30 minute`:
  - dacă există email pe programare/client → trimite email;
  - dacă există telefon → trimite WhatsApp;
  - dacă există ambele → trimite pe **ambele**.
- Mesaj tip: *„Salut! Ai o programare la [Nume business] în 30 de minute ([oră locală business], [timezone]).”*
- După trimitere (sau eșec după o reîncercare) marchează `reminder_sent = true`.
- În dezvoltare, dacă WhatsApp API nu e configurat, canalul WhatsApp poate fi simulat / logat; la producție e necesar cont WhatsApp Business.

---

## 5. Ecrane (MVP)

1. **Onboarding / Auth** — email sau telefon  
2. **Acasă** — acțiuni: panou business / scanează QR / programările mele  
3. **Config business** — timezone → durată → program → pauză → salvare  
4. **QR business** — afișare QR + partajare link  
5. **Cereri business** — listă pending/approved/rejected + acțiuni (deschis și din push)  
6. **Agenda client (tunel)** — calendar/zi + sloturi libere (ore în timezone business)  
7. **Confirmare cerere** — rezumat slot + contact  
8. **Programările mele (client)** — statusuri  
9. **Setări** — date contact, permisiuni push (dacă ești business), logout  

---

## 6. Model de date (logic)

### Utilizator
- `id`, `email` (nullable), `phone` (nullable), `display_name` (optional)  
- Constraint: `email IS NOT NULL OR phone IS NOT NULL`

### BusinessProfile
- `id`, `owner_user_id`, `name`, `public_code` (unic, pentru QR)
- `timezone` (IANA, ex. `Europe/Bucharest`) — **obligatoriu**
- `session_duration_minutes`
- `working_hours` (structură pe zile: ex. mon–sun, start/end sau closed; ore **locale business**)
- `break_hours` (opțional: start/end pe zile sau global; ore **locale business**)
- `created_at`, `updated_at`

### Appointment
- `id`, `business_id`, `client_user_id`
- `start_at`, `end_at` — stocate în **UTC**; derivate din slotul ales în timezone-ul business
- `status`: `pending` | `approved` | `rejected` | `cancelled`
- `client_email`, `client_phone` (copiate la creare, pentru notificări)
- `reminder_sent` (boolean, default false)
- `decision_notified` (boolean, default false) — true după email/WhatsApp la approve/reject
- `created_at`, `updated_at`

### DevicePushToken
- `id`, `user_id` (owner business)
- `expo_push_token`
- `platform` (`ios` | `android`)
- `updated_at`

### NotificationLog (opțional MVP+)
- `appointment_id`, `channel` (`push`|`email`|`whatsapp`), `event` (`pending`|`approved`|`rejected`|`reminder_30m`)
- `success`, `error`, `sent_at`

---

## 7. Statusuri și ocupare slot

| Status | Ocupă slot | Note |
|--------|------------|------|
| `pending` | Da | Rezervare temporară |
| `approved` | Da | Confirmată; eligibilă pentru reminder |
| `rejected` | Nu | Slot eliberat |
| `cancelled` | Nu | Anulare client sau business |

**Expirare pending (default):** după **24 de ore** fără răspuns business → status `cancelled` (sau `expired`) și slot eliberat. Implementare prin cron.

---

## 8. Calcul sloturi libere + timezone

**Timezone business**
- Toate orele din program de lucru și pauze sunt **locale** față de `BusinessProfile.timezone`.
- `start_at` / `end_at` se persistă în **UTC** (conversie la salvare).
- UI-ul afișează orele în timezone-ul business-ului (etichetă clară, ex. „ora României”).
- Reminderul −30 min se bazează pe `start_at` UTC (echivalent cu 30 min înainte de ora locală a programării).

Pentru o **zi calendaristică în timezone-ul business**:
1. Determină începutul/sfârșitul zilei în acel timezone.
2. Generează intervale consecutive de lungime `session_duration_minutes` în programul de lucru al zilei.
3. Elimină intervalele care se suprapun cu pauza.
4. Elimină intervalele care se suprapun cu programări `pending` sau `approved` (comparare pe UTC).
5. Returnează lista rămasă către client (ore formatate local business).

**Condiție de cursă:** la creare programare, verificare atomică (tranzacție / constraint) ca slotul să fie încă liber.

---

## 9. Anti-anonim (reguli stricte)

1. Cont fără email și fără telefon → invalid.  
2. Creare programare fără email și fără telefon pe cont → **refuz server-side**.  
3. La creare, se persistă pe appointment contactul folosit pentru reminder.  
4. Nu există flux de „programare oaspete”.

---

## 10. QR / deep link

- Format app: `programari://b/{public_code}`  
- Format web fallback: `https://<domeniu>/b/{public_code}` (poate redirecționa spre store sau app)  
- Payload QR = URL de mai sus  
- `public_code` este un identificator opac (nu ID intern secvențial expus dacă se poate evita)

---

## 11. Notificări — detalii tehnice

| Canal | Provider (producție) | Folosit pentru |
|-------|----------------------|----------------|
| Push | Expo Push + token pe `DevicePushToken` | Cerere `pending` → business |
| Email | Resend / SMTP / Supabase | Approve, reject, reminder −30 min → client |
| WhatsApp | Meta Cloud API sau Twilio | Approve, reject, reminder −30 min → client (dacă telefon) |

### 11.1 Push la pending (business)
- Trigger: **INSERT** appointment cu `status = pending`.
- Se încarcă toate `expo_push_token` ale `owner_user_id` din business.
- Se trimite prin Expo Push API.
- Idempotență: un push per creare (nu la update-uri ulterioare pe același row, exceptând recrearea).
- Token invalid → șters din `DevicePushToken`.

### 11.2 Email/WhatsApp la approve / reject (client)
- Trigger: **UPDATE** `status` din `pending` → `approved` sau `rejected`.
- Dacă `decision_notified = true` → nu retrimite.
- Trimite pe email și/sau WhatsApp conform contactelor de pe appointment.
- Setează `decision_notified = true` după încercare (cu log de succes/eșec pe canal).

### 11.3 Reminder −30 min (client)
**Scheduler:** Supabase Cron (sau Edge Function periodic) la interval scurt (ex. fiecare 1–5 minute):
- selectează `approved` cu `reminder_sent = false` și `start_at` între now+25min și now+35min (fereastră UTC);
- trimite canalele aplicabile;
- setează `reminder_sent = true`.

Fereastra de 25–35 min evită dublurile la restart-uri și acoperă jitter-ul cron-ului; ținta UX rămâne „cu ~30 min înainte”.

---

## 12. Securitate (MVP)

- RLS Supabase: clientul vede doar propriile programări; business-ul doar pe ale lui.
- Agenda publică (sloturi libere) expusă doar pe baza `public_code`, fără date personale ale altor clienți.
- Doar owner-ul business-ului poate aproba/respinge.
- Token-urile push aparțin utilizatorului autentificat; nu sunt expuse public.
- Validare server-side pe toate mutațiile (status, overlap, contact, timezone valid IANA).

---

## 13. Non-obiective (în afara MVP)

- Plăți online  
- Multi-angajat / multi-locație  
- Program diferit pe sărbători (poate veni ulterior)  
- Chat în app  
- Aprobare admin central pentru conturi business  

---

## 14. Criterii de succes

1. Instalare app → cont cu email sau telefon.  
2. Business configurează timezone + durată + program + pauză → primește QR.  
3. Client scanează QR → vede doar ore/zile libere (în timezone-ul business).  
4. Cerere pending blochează slotul; approve/reject funcționează.  
5. Fără contact → programarea e respinsă.  
6. La cerere pending → push pe dispozitivul business (dacă push e activat).  
7. La approve/reject → client primește email și/sau WhatsApp.  
8. La ~30 min înainte de o programare aprobată → email și/sau WhatsApp trimise automat.

---

## 15. Structură proiect propusă (implementare)

```
programari online/
  docs/superpowers/specs/     # această specificație
  apps/mobile/                # Expo app (+ Expo Notifications)
  supabase/                   # migrations, functions, cron, triggers
  README.md
```

---

## 16. Aprobări

- [x] Arhitectură (Expo + backend cloud)  
- [x] Ecrane + reminder 30 min  
- [x] Model date, statusuri, QR  
- [x] Push la pending (business)  
- [x] Email/WhatsApp la approve/reject (client)  
- [x] Timezone pe business  
- [ ] Review final utilizator pe acest fișier înainte de planul de implementare  

