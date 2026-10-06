# Audit UX cont BUSINESS — Programări (apps/mobile)

**Dată:** 2 octombrie 2026 (Europe/Kiev)  
**Scope:** fluxul BUSINESS (`app/(app)/business/**`, setup, tabs, appointments/cereri, services, staff, hours, WhatsApp în Setări, chat, QR, waitlist, calendar).  
**Nu s-a implementat redesign.** Nu commit. Nu deploy.  
**Excepție geo (Task A, separat):** pickerele Județ → Localitate din browse folosesc acum nomenclatorul `roGeo` / `ro-localitati.json` (toate județele RO), nu doar `uniqueCounties` din business-urile încărcate.

---

## 1. Hartă ecrane business

### Navigare primară

Tab bar: `components/BusinessTabBar.tsx` — 5 tab-uri reale Expo Router (`business/(tabs)/_layout.tsx`).

| Tab | Rută | Fișier(e) | Scop real |
|-----|------|-----------|-----------|
| **Acasă** | `/(app)/business/(tabs)` | `(tabs)/index.tsx` → reexport `home.tsx` → `BusinessHome` | Hub: banner pending, card business + QR, listă lungă de Card-uri către toate sub-ecranele |
| **Cereri** | `…/(tabs)/requests` | `(tabs)/requests.tsx` | Programări (pending / toate): aprobă, respinge, amână, no-show, șterge, mesaj rapid |
| **Clienți** | `…/(tabs)/clients` | `(tabs)/clients.tsx` | Listă clienți (RPC), istoric, note, blocare |
| **Rapoarte** | `…/(tabs)/reports` | `(tabs)/reports.tsx` | KPI ultimele 30 zile (RPC `business_report`) |
| **Setări** | `…/(tabs)/settings` | reexport `settings.tsx` | Profil personal + logo/video firmă + WhatsApp + push + tip cont |

Guard: `business/_layout.tsx` blochează conturile `client` (mesaj + linkuri).

### Ecrane stack (în afara tab-urilor)

| Ecran | Rută | Fișier | Scop |
|-------|------|--------|------|
| Configurare business | `business/setup` | `setup.tsx` (~923 linii) | Nume, categorie, durată, timezone, locație (județ/localitate/stradă/GPS), program + pauză, reguli rezervare, disciplină, zile blocate |
| Servicii | `business/services` | `services.tsx` | CRUD inline (fără delete hard): nume, descriere, durată, preț, active toggle |
| Echipă | `business/staff` | `staff.tsx` | Specialiști: foto, program propriu (opțional), active toggle |
| Calendar pe zi | `business/calendar` | `calendar.tsx` | Date picker + listă ore; filtru staff; blochează ziua |
| Listă așteptare | `business/waitlist` | `waitlist.tsx` | Intrări active; scoate de pe listă |
| Cod QR | `business/qr` | `qr.tsx` | QR HTTPS + share/copy + cod public |
| Mesaje | `business/chat` | `chat/index.tsx` | Listă conversații |
| Thread chat | `business/chat/[id]` | `chat/[conversationId].tsx` | Thread (thin wrapper) |

### Componente cheie

- `WorkingHoursForm` — program Luni–Duminică (folosit în setup + staff)
- `AppointmentCard` — acțiuni pe cereri
- `PickerField` + `lib/roGeo.ts` — județe/localități (deja pe setup; acum și pe browse client)

---

## 2. Flux mental așteptat vs realitate

**Așteptat (owner):** Acasă = „azi / pending / scor” → Cereri = inbox → Calendar = planificare → Servicii/Echipă/Setup = admin rar → Setări = cont.

**Realitate:** Acasă e un **index de navigare** care **dublează** cele 4 tab-uri (Cereri, Clienți, Rapoarte, Setări) plus încă 6 stack screens. Calendar, Servicii, Echipă, Waitlist, Chat, QR **nu apar în tab bar** — doar ca Card pe Acasă. Setup e un formular monolit. Setări amestecă profilul persoanei cu media business și WhatsApp.

---

## 3. Probleme (ce e greșit / confuz / duplicat)

### P3.1 — Acasă business = catalog de link-uri (duplicare tab-uri)
- **Fișier:** `home.tsx` (`BusinessHome`, ~L850–1042)
- **De ce:** Card-uri pentru Cereri, Clienți, Rapoarte, Setări există **și** ca tab-uri. Utilizatorul vede aceeași destinație de două ori. Scroll lung; ierarhia „azi vs admin” dispare.

### P3.2 — Setup monolit (cognitive overload)
- **Fișier:** `setup.tsx`
- **De ce:** Un singur scroll: identitate + locație + program pe 7 zile + pauză + 4 reguli rezervare + disciplină + concedii. Prima configurare e intimidantă; editările frecvente (doar program / doar concediu) forțează același ecran. Lipsește wizard / secțiuni colapsabile / „salvat” per secțiune.

### P3.3 — Mesaj rapid din Cereri nu ajunge la client (bug funcțional)
- **Fișiere:** `requests.tsx` `sendQuickMessage` → `ensureChatConversation(appointment.business_id)`; RPC `ensure_chat_conversation` (v20)
- **De ce:** RPC-ul setează `client_user_id = auth.uid()`. Când owner-ul apelează din Cereri, conversația e **owner ↔ business**, nu owner ↔ clientul programării. Mesajul „rapid” e greșit țintit. Nu există RPC `ensure_chat_conversation(business, client_user_id)` pentru partea business.

### P3.4 — Calendar = doar o zi, fără acțiuni pe slot
- **Fișier:** `calendar.tsx`
- **De ce:** Nu există vedere săptămână/lună; tap pe programare duce la lista Cereri (nu deschide cardul acelei programări). Nu se creează programare manuală din calendar. Filtru staff ok, dar UX-ul e „listă pe zi”, nu agendă.

### P3.5 — Deposit / plăți invizibile în setup
- **Fișier:** `setup.tsx` (`deposit_ron: 0` hardcodat la save)
- **De ce:** Tipul `BusinessProfile` și rapoartele au `deposit_ron` / `deposits_ron`; Cereri refund-uiește la reject. Owner-ul **nu poate seta avansul** din UI. Feature-ul e pe jumătate.

### P3.6 — `maps_url` salvat dar fără UI
- **Fișier:** `setup.tsx` (state `mapsUrl` load/save, fără Field)
- **De ce:** Stare moartă; link Maps nu e editabil (doar GPS via „Locația mea”). Confuzie între `maps_url` și coordonate.

### P3.7 — Staff: program propriu fără pauză editabilă
- **Fișier:** `staff.tsx`
- **De ce:** La `customHours`, se afișează doar `WorkingHoursForm`; `breakHours` din draft se salvează ca default, fără controale. Pauza specialistului nu poate fi setată diferit de default.

### P3.8 — Servicii / staff: fără reorder, fără delete hard
- **Fișiere:** `services.tsx`, `staff.tsx`
- **De ce:** `sort_order` e doar „la append = length”. Toggle `active` există (ok), dar nu există drag-reorder sau ștergere. Liste lungi rămân în ordinea creării.

### P3.9 — Setări: profil personal + media business + WhatsApp amestecate
- **Fișier:** `settings.tsx` (~1476 linii), tab Setări
- **De ce:** Pe cont business apar: avatar personal, logo firmă, video prezentare, telefon, casetă WhatsApp, preferințe notify, push diagnostic, tip cont. Owner-ul caută „setări salon” aici, dar programul/regulile sunt în Setup. WhatsApp e **pe numărul profilului**, nu pe un număr „business” dedicat — copy-ul e ok, dar mental model-ul e confuz.

### P3.10 — Chat business fără badge / fără tab
- **Fișiere:** `BusinessTabBar`, `chat/index.tsx`, Acasă Card „Mesaje clienti”
- **De ce:** Mesajele sunt feature de retenție, dar îngropate; fără unread pe tab bar. Diacritice lipsă în UI (`Mesaje clienti`, `Deschide conversatia`).

### P3.11 — Rapoarte fixe 30 zile; deposits neafișate
- **Fișier:** `reports.tsx`
- **De ce:** Fără selector interval (7/30/90). `deposits_ron` e în tipul Report dar nu e randat. Pending din report tip nu e în grid (doar confirmate, venit, no-show, etc.).

### P3.12 — Timezone IANA ca text liber
- **Fișier:** `setup.tsx` Field „Timezone (IANA)”
- **De ce:** Majoritatea owner-ilor RO nu știu `Europe/Bucharest`. Greșeala rupe sloturile. Ar trebui picker (sau default forțat RO + advanced).

### P3.13 — Un singur business / owner în UI
- **Pattern:** `.maybeSingle()` pe `owner_user_id` în setup, services, staff, calendar, qr, waitlist…
- **De ce:** Schema poate avea mai multe profiluri; UI-ul presupune unul. Al doilea business e invizibil / imprevizibil.

### P3.14 — Waitlist: doar listă pasivă
- **Fișier:** `waitlist.tsx`
- **De ce:** Nu poți „anunță acum”, filtra pe dată, sau vedea status notified. Notificarea e doar side-effect la reject/postpone din Cereri.

### P3.15 — Clienți: fără contact rapid / chat
- **Fișier:** `clients.tsx`
- **De ce:** Note + block + istoric ok; lipsește call / WhatsApp / deschide chat cu acel `client_user_id`. Link-ul secundar duce la Calendar generic.

### P3.16 — Inconsistențe copy / diacritice
- Chat, video hints (`Configureaza`, `Clientii`), Acasă „Mesaje clienti”.
- Success callout pe Cereri e titrat mereu „Amânare reușită” chiar și după delete/approve path-uri care setează `success` diferit (titlul Callout e fix).

### P3.17 — Badge Cereri: poll 60s, fără realtime pe badge
- **Fișier:** `(tabs)/_layout.tsx`
- **De ce:** Lista Cereri are realtime; badge-ul tab se refreshează la focus / 60s. Decalaj posibil față de popup local.

---

## 4. Lipsuri prioritizate

### P0 — blochează încrederea / fluxul de bază

| # | Lipsă / defect | Unde | Notă |
|---|----------------|------|------|
| P0.1 | Mesaj rapid Cereri → conversație greșită (owner ca „client”) | `requests.tsx` + RPC chat | Trebuie RPC business→client + UI |
| P0.2 | Acasă dublează tab-urile; features critice (Calendar, Servicii, Echipă) doar pe Card-uri | `BusinessHome` + TabBar | Re-informa arhitectura: Acasă = azi; admin într-un hub |
| P0.3 | Setup monolit la onboarding | `setup.tsx` | Wizard minim: Nume+categorie → Program → Locație → Gata (+ QR) |
| P0.4 | Fără UI pentru avans (`deposit_ron`) deși plățile/refund există | setup / payments | Sau ascunde refund until deposit UI |

### P1 — UX important, workaround greu

| # | Lipsă | Unde |
|---|-------|------|
| P1.1 | Calendar săptămână + tap → detaliu programare (nu redirect Cereri) | `calendar.tsx` |
| P1.2 | Creare / editare programare de către business (walk-in) | lipsă ecran |
| P1.3 | Separare Setări cont vs Setări business (logo/video → setup sau hub Business) | `settings.tsx` |
| P1.4 | Picker timezone RO (nu text IANA) | `setup.tsx` |
| P1.5 | Pauză pe programul propriu al specialistului | `staff.tsx` |
| P1.6 | Badge unread chat + loc vizibil în nav | TabBar / Acasă |
| P1.7 | Waitlist: acțiune „notifică” + status | `waitlist.tsx` |
| P1.8 | Clienți: call / WhatsApp / chat pe rând | `clients.tsx` |
| P1.9 | Rapoarte: interval selectabil + deposits | `reports.tsx` |
| P1.10 | Field `maps_url` sau eliminare state mort | `setup.tsx` |

### P2 — polish / scale

| # | Lipsă | Unde |
|---|-------|------|
| P2.1 | Reorder servicii / staff (drag pe `sort_order`) | services, staff |
| P2.2 | Delete hard (cu confirm) pe servicii inactive | services |
| P2.3 | Multi-business switcher | toate `.maybeSingle()` |
| P2.4 | Diacritice + titluri Callout corecte pe Cereri | chat, requests |
| P2.5 | Secțiuni colapsabile în Setup (chiar fără wizard) | setup |
| P2.6 | Export / share raport (CSV / imagine) | reports |
| P2.7 | Preview public „cum mă văd clienții” (visit card) din Acasă/Setup | lipsă |
| P2.8 | Badge Cereri pe realtime (nu doar poll) | tabs layout |

---

## 5. Ce funcționează bine (de păstrat)

- Guard `business/_layout` pentru cont client — clar.
- Cereri: approve / reject / postpone / no-show / delete + notify + refund la reject — flux bogat.
- Realtime pe Cereri + notificare locală pentru cereri noi.
- Setup: județ → localitate din `roGeo` (nomenclator complet) + GPS cu timeout — model bun (replicat acum și pe browse client).
- `WorkingHoursForm` pe zi — lizibil.
- Servicii: descriere vizibilă clientului; preț 0 = „la fața locului” — copy util.
- Staff: foto + program moștenit vs propriu — concept clar.
- QR: URL web public (funcționează fără app) + share/copy.
- Rapoarte: top servicii + pe specialist — nucleu bun.
- Auto-approve returning + loyalty + block after no-show — reguli mature, doar UI setup e dens.
- Tab freezeOnBlur — navigare tab-uri stabilă (Pas 5).

---

## 6. Recomandare de direcție (fără implementare acum)

1. **Repară P0.1 (chat business→client)** înainte de orice redesign vizual.  
2. **Restrânge Acasă** la: pending azi, următoarea oră, scor scurt, CTA QR; mută Catalogul de Card-uri într-un „Admin” sau folosește tab-urile.  
3. **Sparge Setup** în 3–4 ecrane (Identitate, Program, Locație, Reguli).  
4. **Calendar săptămână** ca al doilea ecran de lucru după Cereri.  
5. **Unifică „Setări business”** (logo, video, deposit, WhatsApp business) lângă Setup; lasă Setări tab = profil persoană + push.

---

## 7. Fișiere de referință (audit)

```
app/(app)/business/_layout.tsx
app/(app)/business/(tabs)/{_layout,index,requests,clients,reports,settings}.tsx
app/(app)/business/{setup,services,staff,calendar,waitlist,qr}.tsx
app/(app)/business/chat/{index,[conversationId]}.tsx
app/(app)/home.tsx          # BusinessHome
app/(app)/settings.tsx      # shared + business media/WhatsApp
components/{BusinessTabBar,WorkingHoursForm,AppointmentCard}.tsx
lib/{roGeo,chatRpc,notify-client,payments,defaults,types}.ts
supabase/migrations/20260919000000_v20_in_app_chat.sql
```

---

*Raport generat pentru Task B — analiză profundă, fără redesign implementat.*
