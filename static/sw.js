// Service worker: makes the app installable and usable offline (last known alert stays readable).
// Only active on https:// or http://localhost (browser rule).
const VERSION = 'sw-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'data/scenario.json',
  'vendor/preact-htm.js', 'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/chart.umd.js',
  'js/app.js', 'js/store.js', 'js/ui.js', 'js/log.js', 'js/api.js',
  'js/screens/lock.js', 'js/screens/home.js', 'js/screens/impact.js', 'js/screens/map.js',
  'js/screens/ask.js', 'js/screens/checkin.js', 'js/screens/more.js', 'js/screens/forecast.js',
  'js/screens/reports.js', 'js/screens/sources.js', 'js/screens/places.js', 'js/screens/admin.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'tiles').map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API: always network (logs, chat, summaries).
  if (url.pathname.startsWith('/api/')) return;
  // Map tiles: cache what has been seen so the map still shows offline.
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open('tiles').then(async (c) => {
        const hit = await c.match(e.request);
        const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit || Response.error());
        return hit || net;
      })
    );
    return;
  }
  // App shell: network first (so edits show up immediately during development), cache fallback offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok && url.origin === location.origin) {
          const copy = r.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
