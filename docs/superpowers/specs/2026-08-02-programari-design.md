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

---

## 2. Decizii de produs

| Decizie | Alegere |
|--------|---------|
| Roluri | Ambele în aceeași app (business + client) |
| Creare cont business | Oricine se poate înregistra |
| Alegere slot | Doar zile/ore libere din agenda calculată |
| Config business | Mai întâi durata ședinței, apoi program de lucru, pauză opțională |
| Confirmare | Pending până la aprobare/respingere; slot rezervat temporar |
| Identitate | Email SAU telefon obligatoriu; zero anonim |
| Reminder | Automat la start − 30 min, pe canalele disponibile (email/WhatsApp) |
| Stack | Expo (React Native) + Supabase (Auth + DB + job-uri) |

---

## 3. Arhitectură

```
[App Expo Android/iOS]
        |
        | Auth + API
        v
[Supabase]
  - Auth (email / telefon OTP)
  - Postgres (utilizatori, business, programări)
  - Edge Functions / Cron (reminder 30 min, expirare pending opțional)
        |
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
1. Setează **durata ședinței** (minute).
2. Setează **programul de lucru** (zile + interval orar).
3. Opțional: **program de pauză** (interval exclus din sloturi).
4. Salvează profilul → se generează **cod public**, **QR** și link de partajare.
5. Vede cereri pending; **aprobă** sau **respinge**.

### 4.3 Client — programare
1. Scanează QR sau deschide linkul tunel.
2. App citește agenda business-ului și afișează **doar sloturi libere**.
3. Clientul alege zi + oră liberă.
4. Sistemul verifică din nou contactul (email/telefon); refuză dacă lipsește.
5. Creează programare `pending`; slotul devine indisponibil pentru alții.
6. Așteaptă `approved` sau `rejected`.

### 4.4 Reminder automat (−30 min)
- Se aplică doar programărilor cu status **`approved`**.
- La momentul `start_at - 30 minute`:
  - dacă există email pe programare/client → trimite email;
  - dacă există telefon → trimite WhatsApp;
  - dacă există ambele → trimite pe **ambele**.
- Mesaj tip: *„Salut! Ai o programare la [Nume business] în 30 de minute (azi la HH:MM).”*
- După trimitere (sau eșec după o reîncercare) marchează `reminder_sent = true`.
- În dezvoltare, dacă WhatsApp API nu e configurat, canalul WhatsApp poate fi simulat / logat; la producție e necesar cont WhatsApp Business.

---

## 5. Ecrane (MVP)

1. **Onboarding / Auth** — email sau telefon  
2. **Acasă** — acțiuni: panou business / scanează QR / programările mele  
3. **Config business** — durată → program → pauză → salvare  
4. **QR business** — afișare QR + partajare link  
5. **Cereri business** — listă pending/approved/rejected + acțiuni  
6. **Agenda client (tunel)** — calendar/zi + sloturi libere  
7. **Confirmare cerere** — rezumat slot + contact  
8. **Programările mele (client)** — statusuri  
9. **Setări** — date contact, logout  

---

## 6. Model de date (logic)

### Utilizator
- `id`, `email` (nullable), `phone` (nullable), `display_name` (optional)  
- Constraint: `email IS NOT NULL OR phone IS NOT NULL`

### BusinessProfile
- `id`, `owner_user_id`, `name`, `public_code` (unic, pentru QR)
- `session_duration_minutes`
- `working_hours` (structură pe zile: ex. mon–sun, start/end sau closed)
- `break_hours` (opțional: start/end pe zile sau global)
- `created_at`, `updated_at`

### Appointment
- `id`, `business_id`, `client_user_id`
- `start_at`, `end_at`
- `status`: `pending` | `approved` | `rejected` | `cancelled`
- `client_email`, `client_phone` (copiate la creare, pentru reminder)
- `reminder_sent` (boolean, default false)
- `created_at`, `updated_at`

### ReminderLog (opțional MVP+)
- `appointment_id`, `channel` (`email`|`whatsapp`), `success`, `error`, `sent_at`

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

## 8. Calcul sloturi libere

Pentru o zi calendaristică:
1. Generează intervale consecutive de lungime `session_duration_minutes` în programul de lucru al zilei.
2. Elimină intervalele care se suprapun cu pauza.
3. Elimină intervalele care se suprapun cu programări `pending` sau `approved`.
4. Returnează lista rămasă către client.

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

## 11. Notificări reminder — detalii tehnice

| Canal | Provider (producție) | Condiție |
|-------|----------------------|----------|
| Email | Resend / SMTP / Supabase | `client_email` prezent |
| WhatsApp | Meta Cloud API sau Twilio | `client_phone` prezent, format E.164 |

**Scheduler:** Supabase Cron (sau Edge Function periodic) la interval scurt (ex. fiecare 1–5 minute):
- selectează `approved` cu `reminder_sent = false` și `start_at` între now+25min și now+35min (fereastră);
- trimite canalele aplicabile;
- setează `reminder_sent = true`.

Fereastra de 25–35 min evită dublurile la restart-uri și acoperă jitter-ul cron-ului; ținta UX rămâne „cu ~30 min înainte”.

---

## 12. Securitate (MVP)

- RLS Supabase: clientul vede doar propriile programări; business-ul doar pe ale lui.
- Agenda publică (sloturi libere) expusă doar pe baza `public_code`, fără date personale ale altor clienți.
- Doar owner-ul business-ului poate aproba/respinge.
- Validare server-side pe toate mutațiile (status, overlap, contact).

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
2. Business configurează durată + program + pauză → primește QR.  
3. Client scanează QR → vede doar ore/zile libere.  
4. Cerere pending blochează slotul; approve/reject funcționează.  
5. Fără contact → programarea e respinsă.  
6. La ~30 min înainte de o programare aprobată → email și/sau WhatsApp trimise automat.

---

## 15. Structură proiect propusă (implementare)

```
programari online/
  docs/superpowers/specs/     # această specificație
  apps/mobile/                # Expo app
  supabase/                   # migrations, functions, cron
  README.md
```

---

## 16. Aprobări

- [x] Arhitectură (Expo + backend cloud)  
- [x] Ecrane + reminder 30 min  
- [x] Model date, statusuri, QR  
- [ ] Review final utilizator pe acest fișier înainte de planul de implementare  
```
