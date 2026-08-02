# Programari

Aplicație mobilă pentru programări online (business + client): rezervări, aprobare, reminder-uri și scanare QR.

## Structură

- `apps/mobile` — aplicația Expo (React Native + TypeScript + expo-router)

## Pornire locală

```bash
cd apps/mobile
npx expo start
```

## Supabase

Ai nevoie de un proiect Supabase configurat (Auth, database, RLS).

### Variabile de mediu

Creează un fișier `.env` în `apps/mobile` (sau setează variabilele în mediul de rulare):

```
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Fără aceste valori, legătura la backend nu va funcționa.
