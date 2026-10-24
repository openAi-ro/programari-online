/* Programări Online — service worker (PWA shell)
 * Cache-first for static shell; network-first for same-origin API-ish GETs.
 * Never caches Supabase or third-party APIs.
 */
const CACHE_VERSION = 'programari-shell-v3';
const SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isSupabaseOrThirdParty(url) {
  const host = url.hostname;
  if (host.includes('supabase.co') || host.includes('supabase.in')) return true;
  if (host.includes('googleapis.com') || host.includes('gstatic.com')) return true;
  if (host.includes('expo.dev') || host.includes('exp.host')) return true;
  return false;
}

function isShellAsset(url) {
  const path = url.pathname;
  if (path === '/') return true;
  if (path === '/manifest.webmanifest') return true;
  if (path.startsWith('/icons/')) return true;
  if (/\.(js|css|woff2?|ttf|png|jpg|jpeg|webp|svg|ico)$/i.test(path)) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  if (isSupabaseOrThirdParty(url)) return;

  // Cross-origin: do not intercept
  if (url.origin !== self.location.origin) return;

  if (isShellAsset(url)) {
    // Cache-first for static shell
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
            }
            return res;
          })
          .catch(() => offlineFallback());
      })
    );
    return;
  }

  // Network-first for navigations / other same-origin GETs (API-ish)
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && req.mode === 'navigate') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? offlineFallback() : undefined))
      )
  );
});

function offlineFallback() {
  return new Response(
    '<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Offline</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#F0FDFA;color:#0f766e;padding:24px;text-align:center}h1{font-size:1.25rem;margin:0 0 8px}p{margin:0;opacity:.85}</style></head><body><div><h1>Ești offline</h1><p>Verifică conexiunea și reîncearcă. Shell-ul Programări rămâne disponibil când revii online.</p></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
