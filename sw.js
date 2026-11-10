// Offline support: the whole app is precached so the tuner works without a connection.
const VERSION = 'tuner-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/base.css',
  'js/music.js', 'js/pitch.js', 'js/tuner.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (sameOrigin) {
    // Network first for our own files (so updates land), cache fallback offline.
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)) {
    // Cache first for versioned CDN assets.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }))
    );
  }
});
