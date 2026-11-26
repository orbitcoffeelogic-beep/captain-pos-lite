/**
 * CAPTAIN POS LITE — OFFLINE-FIRST SERVICE WORKER (v1.0-lite)
 * Tanpa dependency eksternal (tanpa Tailwind CDN / Google Fonts) -> start instan di tablet lama.
 */
const CACHE_NAME = 'captain-kasir-lite-v1.2';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) return;

  // Network-First dengan no-store agar update dari GitHub langsung aktif, fallback cache saat offline
  event.respondWith(
    fetch(req.url, { cache: 'no-store' })
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        return hit || caches.match('./index.html');
      })
  );
});
