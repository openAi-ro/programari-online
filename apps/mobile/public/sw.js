/* Programări Online — service worker (PWA shell)
 * Navigari si "/" : network-first (cache doar offline), ca shell-ul nou sa ajunga imediat.
 * Asset-uri cu hash (/_expo/static/...): cache-first (continut imuabil).
 * Restul (sw.js, manifest, iconite, fisiere fara hash): network-first, cache doar ca rezerva offline.
 * Nu intercepteaza Supabase, Google, Expo sau alte origini.
 */

const CACHE_VERSION = 'programari-shell-v4';
const OFFLINE_URLS = [
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
      .then((cache) =>
        cache.addAll(OFFLINE_URLS.map((u) => new Request(u, { cache: 'reload' }))).catch(() => undefined)
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
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

function isNavigation(req, url) {
  return req.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';
}

/** Fisierele generate de export au hash in nume (ex. entry-<hash>.js), deci nu se schimba niciodata. */
function isHashedAsset(url) {
  return url.pathname.startsWith('/_expo/static/') && /[-.][0-9a-f]{8,}\.[a-z0-9]+$/i.test(url.pathname);
}

function putInCache(req, res) {
  if (!res || !res.ok) return;
  const copy = res.clone();
  caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => undefined);
}

function networkFirst(req, { store, fallback }) {
  return fetch(req)
    .then((res) => {
      if (store) putInCache(req, res);
      return res;
    })
    .catch(() => caches.match(req).then((cached) => cached || fallback()));
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
  if (url.origin !== self.location.origin) return;

  if (isNavigation(req, url)) {
    event.respondWith(
      networkFirst(req, {
        store: true,
        fallback: () => caches.match('/').then((shell) => shell || offlineFallback()),
      })
    );
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            putInCache(req, res);
            return res;
          })
      )
    );
    return;
  }

  if (url.pathname === '/sw.js') return;
  event.respondWith(networkFirst(req, { store: false, fallback: () => Response.error() }));
});

function offlineFallback() {
  return new Response(
    '<!DOCTYPE html><html lang="ro"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Offline</title><style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#F0FDFA;color:#0f766e;padding:24px;text-align:center}h1{font-size:1.25rem;margin:0 0 8px}p{margin:0;opacity:.85}</style></head><body><div><h1>Ești offline</h1><p>Verifică conexiunea și reîncearcă. Shell-ul Programări rămâne disponibil când revii online.</p></div></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
