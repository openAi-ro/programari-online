# Deploy PWA — Programări Online

## Copy onto Windows PC

From box `/workspace/pwa/out/` → PC repo:

| Box path | PC destination |
|---|---|
| `apps/mobile/public/manifest.webmanifest` | `apps\mobile\public\manifest.webmanifest` |
| `apps/mobile/public/sw.js` | `apps\mobile\public\sw.js` |
| `apps/mobile/public/icons/*` | `apps\mobile\public\icons\` |
| `apps/mobile/public/install-badge.html` | `apps\mobile\public\install-badge.html` |
| `apps/mobile/app/+html.tsx` | `apps\mobile\app\+html.tsx` (replace) |
| `apps/mobile/app/install.tsx` | `apps\mobile\app\install.tsx` (replace) |
| `apps/mobile/docs/pwa-embed.md` | `apps\mobile\docs\pwa-embed.md` |
| `firebase.json` + `.firebaserc` | repo root **or** use `apps/mobile/firebase.json` + `.firebaserc` |

Prefer **root** `firebase.json` (`public: apps/mobile/dist`) if monorepo; use **apps/mobile** copies if you deploy from that folder only.

`projectId` placeholder: `programari-online-50c3e` — change in `.firebaserc` if your Firebase project differs.

## Build + deploy

```bash
cd apps/mobile
npx expo export -p web
# output → apps/mobile/dist  (Expo copies public/ into dist/)

# from repo root (root firebase.json):
firebase deploy --only hosting

# OR from apps/mobile (local firebase.json with public: dist):
cd apps/mobile && firebase deploy --only hosting
```

HTTPS is required for installability (Firebase Hosting provides it).

## User-facing URLs

- Install landing: `https://<host>/install` (also `https://programari.expo.app/install` while on Expo Hosting)
- Manifest: `/manifest.webmanifest`
- Service worker: `/sw.js`
- Embed snippet: see `apps/mobile/docs/pwa-embed.md`

## Notes

- Native Android/iOS builds unchanged (PWA files are web/`public` + `+html.tsx` web-only).
- SW skips caching Supabase / Google / Expo hosts.
- Chrome: „Adaugă pe ecranul de start” / Install; iOS Safari: Share → Home Screen.
