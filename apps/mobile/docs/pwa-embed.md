# Embed - buton Instaleaza Programari (PWA / APK / iOS)

Inlocuieste `WEB_BASE` cu baza site-ului (ex. `https://programari-online-50c3e.web.app` sau `https://programari.expo.app`).

## Snippet HTML

```html
<a href="https://programari-online-50c3e.web.app/install" rel="noopener">Instaleaza Programari</a>
```

## Pagina `/install`

1. **Instaleaza pe ecran** - PWA (Chrome / Safari Home Screen)
2. **QR Descarca aplicatia Android** - `getAndroidInstallUrl()` (APK / Expo build)
3. **QR Descarca aplicatia iOS** (sub Android) - `getIosInstallUrl()` = PWA Safari (`?platform=ios`)

iOS nu permite IPA libera ca pe Android. Calea curenta: Safari → Partajeaza → Pe ecranul Home.
Cand exista App Store / TestFlight, seteaza `EXPO_PUBLIC_IOS_INSTALL_URL` sau `extra.iosInstallUrl`.