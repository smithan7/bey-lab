// Bump CACHE_VERSION on every release.
const CACHE_VERSION = 'bey-lab-v1';
const PHOTO_CACHE = 'bey-lab-photos';
const PHOTO_HOST = 'static.wikia.nocookie.net';
const CORE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'data/parts-catalog.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'src/catalog.js', 'src/combo.js', 'src/lineup-worker.js', 'src/lineup.js', 'src/matchups.js',
  'src/rng.js', 'src/scoring.js', 'src/seed.js', 'src/sim.js', 'src/stats.js', 'src/store.js', 'src/suggest.js',
  'src/ui/app.js', 'src/ui/settings.js', 'src/ui/log.js', 'src/ui/combos.js',
  'src/ui/lineup.js', 'src/ui/next.js', 'src/ui/library.js', 'src/ui/pickers.js', 'src/photos.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION && k !== PHOTO_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === PHOTO_HOST) {
    e.respondWith(photo(req));
  } else if (url.origin === self.location.origin) {
    staleWhileRevalidate(e);
  }
});

async function photo(req) {
  const cache = await caches.open(PHOTO_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req.url, { mode: 'no-cors', referrerPolicy: 'no-referrer' });
  // Opaque (no-cors) responses hide their status, so a failed fetch can't be told apart; cached anyway.
  if (res.ok || res.type === 'opaque') cache.put(req.url, res.clone()).catch(() => {});
  return res;
}

function staleWhileRevalidate(e) {
  const req = e.request;
  // Start the network request synchronously so waitUntil is called during dispatch.
  const net = fetch(req).then(async (res) => {
    if (res.ok) {
      const cache = await caches.open(CACHE_VERSION);
      await cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await net;
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
}
