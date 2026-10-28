// Service worker: caches the app shell so Tideline opens offline.
// Forecast data is not cached here – the app keeps the last forecast per spot in localStorage.
// Bump VERSION whenever you change any app file so installed copies pick up the update.
const VERSION = 'tideline-v1';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/astro.js',
  'js/tides.js',
  'js/scoring.js',
  'vendor/suncalc.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return; // APIs go straight to network
  // Network first (so updates show up), falling back to cache when offline
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then(r => r || caches.match('index.html'))));
});
