# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Supabase: tabele noi
Din 30.10.2026, orice tabel nou din schema `public` are nevoie, în aceeași migrație, de `enable row level security` și GRANT explicit: `anon` doar pentru date publice, iar `authenticated` și `service_role` pentru select/insert/update/delete. Detalii în `supabase/README.md`.

## Limbă: nu se amestecă pe pagină

O pagină este într-o singură limbă, `ro` sau `en`. Limba vine din `useLanguage()`, din limba salvată sau din `?lang=ro` / `?lang=en`. Toate textele de interfață de pe ecranul acela folosesc limba asta, inclusiv titlul din browser și `document.documentElement.lang`.

- Textul de interfață trece prin `tr()` sau `translateTo(lang, ...)`. `lang` este limba paginii, nu `'ro'` fix.
- În `lib/locales/en.ts` nu se scrie română. În `lib/locales/ro.ts` nu se scrie engleză. Aceeași cheie, două limbi.
- Nu se lasă două butoane care spun același lucru în limbi diferite.
- Rămân neschimbate: numele de marcă (Instagram, Facebook, WhatsApp) și ce a scris firma (nume, servicii, adresă, descriere salvată).
