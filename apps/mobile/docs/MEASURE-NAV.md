# Măsurare navigare meniu business (BEFORE vs AFTER)

## De ce „nu pot să văd” îmbunătățirea

| | Live | Local (cu Pas 1–3) |
|---|---|---|
| URL | https://programari.expo.app | **http://localhost:8081** |
| Versiune afișată | **v2.41** | **v2.42** |
| Fixuri soft-refresh + tab bar pe skeleton | **NU** (fără deploy) | **DA** (doar pe disc) |

Dacă te uiți pe **programari.expo.app**, vezi build-ul vechi. Fixurile sunt doar locale, **fără EAS deploy**.

## Cum pornești app-ul cu fixuri

```powershell
cd "C:\Users\Administrator\Desktop\programari online\apps\mobile"
npm run start:web
# sau: npx expo start --web --port 8081
```

Apoi deschide: **http://localhost:8081**

Autentifică-te ca business, apoi comută tab-urile. În Metro/consola browser (F12 → Console) apar linii:

```
[NAV] START → requests ...
[NAV] READY requests ms=123 soft=true hasExistingData=true ...
```

Metro rulează deja pe această mașină: **http://localhost:8081** (verificat Sep 25, 2026).

## Numere BEFORE vs AFTER

### Metodă
1. Instrumentare `__DEV__` în `BusinessTabBar` + ecrane (`lib/navTiming.ts`) — log `[NAV]`.
2. Harness public doar în `__DEV__`: **http://localhost:8081/dev-nav-bench**
3. Playwright (headless Chromium) a rulat automat suite AFTER apoi BEFORE.
4. Latență API simulată în bench: **700 ms** (ordin de mărime pentru cold load UI).
5. RTT real Supabase (query simplu, 5 probe): **122–498 ms, medie ~217 ms**.

### Rezultate bench (perceived time until content ready)

**AFTER (Pas soft-refresh, date păstrate în memorie):**

| Switch | Vizită | ms | soft |
|---|---|---:|---|
| home | 1 (cold) | ~701 | false |
| requests | 1 | ~710 | false |
| clients | 1 | ~714 | false |
| reports | 1 | ~709 | false |
| settings | 1 | ~704 | false |
| **requests** | **2 (revisit)** | **~0** | **true** |
| **home** | **2 (revisit)** | **~0** | **true** |

**BEFORE (mereu skeleton / `setLoading(true)`):**

| Switch | Vizită | ms | soft |
|---|---|---:|---|
| home / requests / clients / reports / settings | 1 | ~701–710 | false |
| **requests** | **2** | **~701** | **false** |
| **home** | **2** | **~710** | **false** |

### Pe scurt
- **Prima vizită (cold):** ~700 ms în ambele (dominată de fetch) — similar BEFORE/AFTER.
- **Revisit cu date deja încărcate:**
  - **AFTER: ~0 ms** (conținut rămâne vizibil, refresh în fundal)
  - **BEFORE: ~700 ms** (skeleton din nou, aștepți fetch-ul)

Scalare la rețeaua reală: înlocuiește 700 ms cu RTT-ul tău (ex. ~200–800 ms pe ecrane cu mai multe query-uri). Raportul rămâne: soft ≈ **0–16 ms**, cold ≈ **RTT**.

### Alt câștig UX (Pas tab bar pe skeleton)
În AFTER, `BusinessTabBar` rămâne montat și pe ecranele de loading — poți schimba tab-ul imediat. În BEFORE (HEAD), skeleton-ul înlocuia tot ecranul **fără** tab bar.

### Notă arhitectură
Cu `Stack` + `router.replace`, ecranele se **remontează** la schimbarea tab-ului, deci `rows`/`report` din state se resetează. Soft-refresh din Pas 1–3 ajută clar la **re-focus pe același ecran** (app din background, pull-to-refresh). Bench-ul arată beneficiul când datele rămân în memorie (ca la un cache de modul / Tabs). Tab bar pe skeleton ajută mereu la switch între tab-uri.

## Stare disc finală
- Fixuri Pas 1–3: **păstrate**
- Loguri `[NAV]` în `__DEV__`: **păstrate** (`lib/navTiming.ts`)
- `app/dev-nav-bench.tsx`: harness măsurare (doar `__DEV__`)
- Fără commit / fără EAS deploy
- Backup: `programari online\.measure-nav\`
## Pas 5 — Tabs reale (local, Sep 25 2026)

Business primary menus folosesc `app/(app)/business/(tabs)/` (Expo Router `Tabs`).
Switch-ul NU mai face `router.replace` pe Stack — ecranele rămân montate (`lazy` + `freezeOnBlur`).

### Cum testezi
1. `npm run start:web` → http://localhost:8081
2. Login business → ar trebui să ajungi pe `/business/(tabs)` (redirect din `/home`)
3. Comută rapid Acasă / Cereri / Clienți / Rapoarte / Setări
4. În consolă `[TAB_MOUNT] business/...`: count crește **o dată** per tab la prima vizită; la revisit **nu** mai crește
5. Client mode: `/home` + ClientTabBar neschimbat
6. Fără commit / fără EAS deploy
