// App shell and data: network first (so updates arrive), cache as the offline fallback.
// Photos: served from the media cache filled by "Download for offline", else network.
// Audio is not handled here; the app plays offline audio from blob URLs itself.
const SHELL = 'bird-sounds-shell-v1';
const MEDIA = 'bird-sounds-media';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'js/app.js',
  'js/learn.js',
  'data/species.json',
  'data/calls.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bird-sounds-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
    );
    return;
  }

  if (req.destination === 'image') {
    e.respondWith(
      caches.open(MEDIA).then((c) => c.match(req.url)).then((hit) => hit || fetch(req)),
    );
  }
});
