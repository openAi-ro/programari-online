# Șabloane WhatsApp (Meta Cloud API) — Programari

Mesajele trimise de aplicație din proprie inițiativă (confirmări, reminder-e etc.) ajung la client
**doar** dacă sunt trimise ca șablon aprobat de Meta. Textul liber ajunge numai dacă clientul
a scris numărului de business în ultimele 24 de ore (altfel Meta răspunde cu eroarea 131047).

Cum funcționează în cod (`supabase/functions/_shared/notify.ts`):

- pentru fiecare tip de mesaj, dacă secretul `WHATSAPP_TPL_<TIP>` conține numele șablonului aprobat,
  se trimite șablonul, cu variabilele în **ordinea fixă** de mai jos (`WA_TEMPLATE_VARS`);
- dacă secretul lipsește, se trimite textul liber de până acum (nimic nu se strică);
- limba șablonului: `WHATSAPP_TPL_LANG` (implicit `ro`);
- mesajele din chat rămân text liber.

Creare: Meta Business Suite → WhatsApp Manager → **Message templates** → Create template.
Pentru toate (în afară de OTP): **Category: Utility**, **Language: Romanian (ro)**, fără butoane, fără
header. Nu folosiți cuvinte promoționale (ofertă, reducere, promoție, „nu rata”) — altfel Meta
le reclasifică drept Marketing (taxate diferit și blocate fără opt-in).
Variabilele nu pot fi nici la începutul, nici la sfârșitul textului — de aceea fiecare text se
termină cu o propoziție fixă.

După aprobare, setați în Supabase → Project Settings → Edge Functions → Secrets numele șablonului
(exact cum apare în Meta) în secretul din coloana „Secret”.

---

## 1. Programare confirmată

- **Secret:** `WHATSAPP_TPL_CONFIRMED`
- **Name:** `programare_confirmata`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! Programarea dumneavoastră la {{1}} pentru {{2}} a fost confirmată. Vă așteptăm cu drag.
  ```

- **Variabile (ordinea trimisă de cod):** {{1}} = numele salonului · {{2}} = data și ora
- **Exemple:** {{1}} `Salon Ana` · {{2}} `20 oct. 2026, 10:00`
- **Footer (opțional):** `Programari`

## 2. Programare respinsă

- **Secret:** `WHATSAPP_TPL_REJECTED`
- **Name:** `programare_respinsa`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! Ne pare rău, programarea dumneavoastră la {{1}} pentru {{2}} nu a putut fi confirmată. Puteți alege alt interval din aplicație.
  ```

- **Variabile:** {{1}} = numele salonului · {{2}} = data și ora
- **Exemple:** {{1}} `Salon Ana` · {{2}} `20 oct. 2026, 10:00`
- **Footer (opțional):** `Programari`

## 3. Programare mutată / amânată

Folosit atât când salonul mută programarea, cât și când o amână cu câteva ore.

- **Secret:** `WHATSAPP_TPL_MOVED`
- **Name:** `programare_mutata`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! Programarea dumneavoastră la {{1}} a fost mutată. Noua dată și oră: {{2}}. Detaliile sunt în aplicație, la Programările mele.
  ```

- **Variabile:** {{1}} = numele salonului · {{2}} = noua dată și oră
- **Exemple:** {{1}} `Salon Ana` · {{2}} `20 oct. 2026, 12:00`
- **Footer (opțional):** `Programari`

## 4. Reminder cu 24 de ore înainte

- **Secret:** `WHATSAPP_TPL_REMINDER_24H`
- **Name:** `reminder_programare_24h`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! Vă reamintim că mâine aveți o programare la {{1}}, la ora {{2}}. Vă rugăm să confirmați prezența din aplicație, la Programările mele.
  ```

- **Variabile:** {{1}} = numele salonului · {{2}} = ora (HH:MM)
- **Exemple:** {{1}} `Salon Ana` · {{2}} `10:00`
- **Footer (opțional):** `Programari`

## 5. Reminder cu 30 de minute înainte

- **Secret:** `WHATSAPP_TPL_REMINDER_SOON`
- **Name:** `reminder_programare_curand`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! Programarea dumneavoastră la {{1}} începe la ora {{2}}, în aproximativ 30 de minute. Vă așteptăm.
  ```

- **Variabile:** {{1}} = numele salonului · {{2}} = ora (HH:MM)
- **Exemple:** {{1}} `Salon Ana` · {{2}} `10:00`
- **Footer (opțional):** `Programari`

## 6. Reamintire pentru o nouă programare (rebook)

> Atenție: Meta poate clasifica acest tip de mesaj drept **Marketing** chiar dacă textul e neutru,
> pentru că nu e legat de o programare existentă. Dacă este reclasificat, fie îl acceptați ca
> Marketing (clientul trebuie să fi acceptat mesajele), fie lăsați secretul nesetat (rămâne
> notificarea push + email).

- **Secret:** `WHATSAPP_TPL_REBOOK`
- **Name:** `reamintire_programare_noua`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! Ultima dumneavoastră vizită la {{1}} pentru {{2}} a fost acum ceva timp. Dacă doriți, puteți face o nouă programare din aplicație.
  ```

- **Variabile:** {{1}} = numele salonului · {{2}} = serviciul
- **Exemple:** {{1}} `Salon Ana` · {{2}} `Tuns și coafat`
- **Footer (opțional):** `Programari`

## 7. Loc eliberat (listă de așteptare)

- **Secret:** `WHATSAPP_TPL_WAITLIST`
- **Name:** `loc_eliberat_lista_asteptare`
- **Category:** Utility · **Language:** Romanian
- **Body:**

  ```
  Bună ziua! S-a eliberat un loc la {{1}} pe data de {{2}}, pentru care v-ați înscris pe lista de așteptare. Linkul de rezervare: {{3}} (valabil cât timp locul este liber).
  ```

- **Variabile:** {{1}} = numele salonului · {{2}} = data (AAAA-LL-ZZ) · {{3}} = linkul de rezervare
- **Exemple:** {{1}} `Salon Ana` · {{2}} `2026-10-20` · {{3}} `https://programari.expo.app/b/ABC123`
- **Footer (opțional):** `Programari`

## 8. Cod de autentificare (OTP)

Șabloanele de autentificare au text fix generat de Meta (nu se scrie body propriu).

- **Secret:** `WHATSAPP_OTP_TEMPLATE` (+ `WHATSAPP_OTP_TEMPLATE_LANG` = `ro`, `WHATSAPP_OTP_BUTTON_TYPE` = `url`)
- **Name:** `cod_autentificare`
- **Category:** **Authentication** · **Language:** Romanian
- **Code delivery:** Copy code (buton „Copiază codul”)
- **Opțiuni:** bifați „Add security recommendation” și „Add expiration time” = **15 minute**
- **Body (generat de Meta):** `{{1}} este codul dvs. de verificare. Din motive de securitate, nu divulgați acest cod.`
- **Variabile:** {{1}} = codul (6 cifre) — trimis de cod și în body, și în butonul Copy code
- **Exemplu:** {{1}} `482913`
- **Footer (generat):** `Acest cod expiră în 15 minute.`

---

## Mesaje care rămân text liber

- testul WhatsApp din Setări (ajunge doar dacă ați scris numărului business în ultimele 24 h);
- notificările către proprietarul salonului (cerere nouă / programare mutată de client);
- mesajele din chat.

## Urmărirea livrării

Fiecare încercare este salvată în tabelul `notification_log` (destinatar mascat, șablon, `wamid`,
status, cod de eroare). Webhook-ul `whatsapp-webhook` actualizează statusul în
`sent` / `delivered` / `read` / `failed` (de ex. 131047 = în afara ferestrei de 24 h,
131030 = destinatarul nu e în lista de test).
