const CACHE_NAME = 'captain-owner-v1.1';
const CORE_ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE_ASSETS).catch(() => {})));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.includes('script.google.com') || u.hostname.includes('script.googleusercontent.com')) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-store' })
      .then((res) => { if (res && res.ok) { const cl = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(req, cl)); } return res; })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match('./index.html'))
  );
});
