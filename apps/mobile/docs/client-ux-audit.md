# Audit UX client — Programări (apps/mobile)

**Dată:** 2 octombrie 2026 (Europe/Kiev)  
**Scope:** doar fluxul CLIENT (tab-uri + scan / book / chat / map).  
**Nu s-a implementat redesign.** Nu commit. Nu deploy.

---

## 1. Hartă ecrane client (tab → scop)

Tab bar: `components/ClientTabBar.tsx` — 5 tab-uri, montat manual pe ecranele client (nu e Tabs navigator Expo).

| Tab | Rută | Fișier(e) | Scop real |
|-----|------|-----------|-----------|
| **Acasă** | `/(app)/home` | `app/(app)/home.tsx` → `ClientHome` | Hub: profil, următoarea programare, QR/cod, favorite, recent, fidelitate, link-uri Descoperă + Mesaje |
| **Caută** | `/(app)/browse` (+ `/browse/[categoryId]`, `/map`) | `browse/index.tsx`, `browse/[categoryId].tsx`, `map.tsx` | Descoperire: căutare nume/cod, județ/localitate, grid 14 categorii, listă business; map = „aproape de mine” (listă sortată, nu hartă vizuală densă) |
| **Programări** | `/(app)/my-appointments` | `my-appointments.tsx` | Listă programări (toate / viitoare / trecute), anulare, reprogramare, confirmare prezență, recenzie, calendar, drive, mesaj rapid |
| **Favorite** | `/(app)/favorites` | `favorites.tsx` | Listă saloane favorite (cloud + local) → book |
| **Cont** | `/(app)/settings` | `settings.tsx` | Profil, telefon, WhatsApp, notificări, temă, tip cont, logout; + link Mesaje |

### Ecrane client în afara tab-ului (stack)

| Ecran | Rută | Scop |
|-------|------|------|
| Scan QR | `/(app)/scan` | Cameră QR + cod manual → `book/[publicCode]` |
| Book wizard | `/(app)/book/[publicCode]` | Pași: specialist → serviciu → dată → oră → confirm; card vizită + favorite; waitlist / deposit |
| Chat list | `/(app)/chat` | Conversații cu business-uri |
| Chat thread | `/(app)/chat/[conversationId]` | Mesaje 1:1 |
| Map / near | `/(app)/map` | Business-uri sortate pe distanță (match tab Caută) |

**Notă:** `home.tsx` conține și `BusinessHome` — la `mode === 'business'` redirecționează spre `business/(tabs)`. Analiza de mai jos ignoră business side.

---

## 2. Probleme (greșit / duplicat / confuz)

### P2.1 — Acasă supraîncărcată (hub = gunoi pe verticală)
- **Fișier:** `app/(app)/home.tsx` (`ClientHome`)
- **De ce:** Ordinea actuală: hero → card profil → next apt (sau empty) → banner Scan → Field cod → buton → Favorite (listă) → Rezervă din nou → Fidelitate → Descoperă (2 carduri) → Contul tău / Mesaje. Utilizatorul trebuie să deruleze mult ca să ajungă la descoperire sau la fidelitate. Acțiunile primare (rebook, scan, confirm) concurează cu meta-profil și link-uri care există deja în tab-uri.

### P2.2 — Favorite în trei locuri
- **Fișiere:** `home.tsx` (secțiune), `favorites.tsx` (tab), `ClientTabBar` tab „Favorite”
- **De ce:** Aceeași listă pe Acasă și pe tab. Tab-ul Favorite e justificat, dar secțiunea de pe Acasă dublează scroll-ul și diluează ierarhia. „Rezervă din nou” (recent) se suprapune conceptual cu favoritele.

### P2.3 — Browse: rând compact + BusinessVisitCard complet sub fiecare rezultat
- **Fișiere:** `browse/index.tsx`, `browse/[categoryId].tsx` (`SalonRow`)
- **De ce:** Fiecare business afișează (1) rând tip listă (logo, nume, hint, chevron) **și** (2) `BusinessVisitCard` cu QR mare, telefon, + `PromoVideo` dacă există. Lista de descoperire arată ca un feed de „cărți de vizită” — greu de scanat, QR e redundant când userul e deja în app (tap → book), video-urile multiple pot auto-încărca / greși lista. **Cea mai mare problemă de densitate UX din client.**

### P2.4 — QR / Scan / Cod public — 4 intrări
- **Fișiere:** `home.tsx` (banner + Field), `browse/index.tsx` (buton QR), `scan.tsx`, `BusinessVisitCard` (QR pe fiecare card)
- **De ce:** Mesajul „cum rezerv” e fragmentat. Clientul nou nu știe care e calea „oficială”. După ce există Caută + categorii, codul pe Acasă e secondary — dar ocupă prim-plan.

### P2.5 — Mesaje ascunse (nu sunt în tab bar)
- **Fișiere:** `home.tsx` (Card Mesaje), `settings.tsx` (Card Mesaje), `chat/index.tsx` (fără `ClientTabBar`)
- **De ce:** Chat e feature de retenție, dar e îngropat. Pe chat lipsește tab bar → senzație de „ieșire din app”. Nici badge unread pe tab.

### P2.6 — „Confirmă că ajung” pe Acasă duce la Programări, nu confirmă
- **Fișier:** `home.tsx` (~L782–792)
- **De ce:** CTA sună ca acțiune imediată, dar `router.push('/(app)/my-appointments')`. Userul trebuie încă un tap. Confuzie de copy vs comportament.

### P2.7 — Callout-uri tehnice în Caută
- **Fișiere:** `browse/index.tsx`, `browse/[categoryId].tsx`
- **De ce:** Texte tip „Mod local — RPC v26 încă neaplicat”, „Lista vine din SELECT direct”. Expun detalii de infrastructură clienților finali.

### P2.8 — Duplicare UI filtre browse vs categorie
- **Fișiere:** `browse/index.tsx` + `browse/[categoryId].tsx`
- **De ce:** Aceleași Field + Județ + Localitate + butoane; pe index în plus grid categorii **și** lista completă filtrată (toate categoriile). Index-ul e simultan „hub categorii” și „search results” — rol dublu. Pe categorie, „Aproape de mine” e toggle in-page; pe index e navigare la `/map` — inconsistență.

### P2.9 — Map tab match fără hartă dominantă
- **Fișiere:** `map.tsx`, `ClientTabBar` (`match: browse || map`)
- **De ce:** Tab „Caută” rămâne activ pe map, ok; dar ecranul e listă + distanță (nu pin-uri pe hartă ca UI principal). Label-ul „Aproape de mine” de pe Acasă vs realitatea „listă sortată” poate dezamăgi.

### P2.10 — Settings client partajează ecranul cu logică business
- **Fișier:** `settings.tsx` (~1500 linii)
- **De ce:** Pentru client, logo/video business sunt gated de `appMode === 'business'`, dar fișierul e greu de întreținut; redirect business → tabs settings. Pentru client, „Tip cont” + diagnostic push detaliat pot speria / spația inutil Contul.

### P2.11 — Book: card vizită pe tot wizard-ul
- **Fișier:** `book/[publicCode].tsx`
- **De ce:** `BusinessVisitCard` (posibil cu video) stă deasupra stepper-ului la fiecare pas. La slot/confirm, atenția ar trebui pe oră / CTA, nu pe QR/video. Wizard-ul în sine (staff→service→date→slot→confirm) e clar și bun.

### P2.12 — Tab bar: fără feedback haptic / indicator animat; 5 tab-uri înghesuite
- **Fișier:** `ClientTabBar.tsx`
- **De ce:** Icon outline static + label; pe ecrane înguste „Programări” se comprimă (`adjustsFontSizeToFit`). Favorite ca tab dedicat e agresiv față de Mesaje (care merită mai mult expunere dacă e product priority).

### P2.13 — Empty state Acasă vs realitate Caută
- **Fișier:** `home.tsx` EmptyState
- **De ce:** Empty next-apt spune doar „Scanează QR / introdu codul” — nu menționează tab-ul Caută / categorii, deși descoperirea există.

### P2.14 — Animații / canvas: reanimated almost unused
- **Fișiere:** `app/_layout.tsx` (import side-effect `react-native-reanimated`), `components/ui.tsx` (doar `Animated` din RN pentru skeleton pulse)
- **De ce:** Dependență grea instalată, zero micro-interacțiuni pe tab switch, listă, loyalty progress, scan frame. Nu există `expo-blur`, `expo-linear-gradient`, `@shopify/react-native-skia` în `package.json`.

---

## 3. Funcții lipsă (expose for analysis) — P0 / P1 / P2

### P0 — impact imediat pe conversie / claritate
1. **Listă Caută „compact-first”** — un singur rând/card per business; VisitCard + video doar pe detalii (book) sau expand pe tap lung / „Vezi prezentare”.
2. **Acasă: „Confirmă că ajung” = RPC inline** (sau bottom sheet pe apt), nu redirect orb la Programări.
3. **Ascunde callout-uri RPC/SELECT** din UI client (păstrează-le în `__DEV__` sau remote config).
4. **Empty Acasă → CTA primar „Caută business”** pe lângă Scan.

### P1 — retenție / navigare
5. **Mesaje în tab bar** (badge unread) SAU badge pe Cont + tab bar pe ecranele chat.
6. **Acasă slim:** next apt → CTA-uri rapide (Scan | Cod | Caută) → rebook recent (max 3 orizontal) → fidelitate compactă; scoate lista Favorite duplicată și cardurile Descoperă/Mesaje (deja în tabs).
7. **Browse index = hub:** search + categorii; rezultatele text apar după submit / după categorie — nu lista + VisitCard pe tot feed-ul.
8. **Unificare Near Me:** același pattern pe index și pe categorie (toggle, nu doar navigare map).
9. **Scan din tab bar** (opțional FAB pe Acasă/Caută) — o singură „poartă” vizibilă pentru QR.

### P2 — polish / creștere
10. Rating + număr recenzii pe rândul din Caută (când RPC e live).
11. Filtre: „Deschis acum”, sortare distanță/rating pe browse.
12. Hartă reală (pins) pe `/map` — acum e listă; leaflet/maps există deja în deps.
13. Loyalty pe Acasă: tap → book la acel business; animație progress.
14. Onboarding client (3 slides): Scan / Caută / Programările mele.
15. Deep link share din VisitCard fără a forța QR pe fiecare rând de listă.
16. Preferință „orașul meu” salvată — prefill județ/localitate.

---

## 4. Propunere rearanjare profesională — Acasă + Caută

### 4.1 Acasă (ordine propusă)

1. **Greeting scurt** — „Salut, {prenume}” (fără card profil mare; edit din Cont).
2. **Hero next appointment** (dacă există) — status, oră, 2 CTA max: Confirmă (inline) + Detalii; secundar: Condu / Rebook.
3. **Quick actions** (row 3 iconuri): Scanează QR · Introdu cod · Caută.
4. **Rezervă din nou** — horizontal scroll max 5 chip/card mici (nu listă verticală + favorite duplicate).
5. **Fidelitate** — 1–2 carduri progress (dacă există).
6. **(Opțional) Banner promo** — o categorie populară / „Aproape de tine”.

**Scoate de pe Acasă:** card profil editabil, listă Favorite completă, carduri Descoperă, card Mesaje, Field cod lung (mută în sheet pe „Introdu cod”).

### 4.2 Caută (ierarhie)

**Index (`browse/index`):**
1. Search bar sticky (nume / cod).
2. Chip-uri rapide: Aproape de mine · Județ · Localitate (filtre în sheet, nu 2 Picker-uri grele deasupra).
3. **Grid categorii** (hero vizual) — fără listă infinite sub el la load.
4. Doar dacă `q` / filtre active → **listă compactă** (logo + nume + oraș + distanță/rating + chevron). Fără VisitCard/QR/video în rând.

**Categorie (`browse/[categoryId]`):**
1. Titlu categorie + count.
2. Aceleași filtre compacte + Near Me toggle.
3. Listă compactă → tap = book (unde VisitCard + PromoVideo au loc sus, o dată).

**Map:** păstrează ca mod „Near”; ideal pins + bottom sheet listă.

---

## 5. Efecte canvas / motion recomandate

### Ce există deja în proiect
| Librărie | Versiune / status | Folosire actuală |
|----------|-------------------|------------------|
| `react-native-reanimated` | 4.5.1 (+ worklets) | Import în root; **fără animații UI reale** |
| RN `Animated` | built-in | Skeleton pulse în `components/ui.tsx` |
| `expo-video` | ~57 | `PromoVideo` |
| `react-native-svg` / QR | da | QR pe VisitCard |
| `expo-blur` / `LinearGradient` / Skia | **absente** | — |

### Recomandări (fără a adăuga Skia dacă nu e nevoie)

1. **Tab bar active indicator** — Reanimated `withSpring` pe pill/underline (ClientTabBar).
2. **Loyalty fill** — Reanimated width progress (home / LoyaltyRow) în loc de View static.
3. **List item press** — scale 0.98 + opacity (SalonRow compact, BizCardRow).
4. **Scan finder** — colțuri animate / pulse pe `scan.tsx` frame (Reanimated).
5. **Book stepper** — fade/slide ușor între pași (Reanimated `FadeInRight`).
6. **Category tiles** — overlay gradient pe label (adaugă `expo-linear-gradient` — ușor, Expo-first) în loc de `rgba` flat.
7. **PromoVideo** — thumbnail + play overlay (nu player full pe listă); pe book, blur backdrop opțional (`expo-blur`) sub modal confirm.
8. **Skia** — **nu** recomandat acum (bundle + complexitate); doar dacă vrei blob/mesh pe hero Acasă mai târziu.

**Prioritate motion:** tab indicator + loyalty + list press (Reanimated deja în deps) → gradient categorii (`expo-linear-gradient` nou, mic) → blur doar pe sheet-uri.

---

## 6. Ce NU atinge (business side)

Nu modifica / nu redesena în acest audit:
- `app/(app)/business/**` (tabs, calendar, cereri, clienți, rapoarte, staff, services, waitlist, QR business, setup)
- `BusinessTabBar`, `BusinessHome` din `home.tsx` (doar redirect)
- Upload logo / video din settings când `appMode === 'business'`
- RPC-uri owner, notificări cereri business, realtime pending pe BusinessHome
- Configurare working hours / deposit / loyalty_every din partea owner

VisitCard / PromoVideo pot fi **consumate** pe client, dar upload-ul și setup-ul rămân pe business.

---

## 7. Rezumat executiv (pentru Rafael)

Clientul are **fundament solid**: tab-uri clare, book wizard bun, favorite cloud, loyalty, chat, scan, categorii vizuale.  
Punctul slab principal e **densitatea pe Caută** (rând + carte de vizită + video pe fiecare rezultat) și **Acasă ca pagină-dump** care dublează Favorite / Descoperă / Mesaje.  

**Cel mai mare win fără redesign total:** (1) listă compactă pe browse, VisitCard doar pe book; (2) Acasă redusă la next-apt + quick actions + rebook; (3) confirmare prezență inline; (4) folosește Reanimated deja instalat pentru micro-motion.

---

*Generat din inspecție de cod pe `apps/mobile` — fără implementare redesign.*