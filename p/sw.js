/* Selective Color — service worker (app shell cache, SPEC C20).
 * Scope is /p/. Everything the app needs to boot lives under that scope.
 */
const VERSION = 'sc-v5';   // bump on EVERY release: the shell is cache-first
const SHELL = `${VERSION}-shell`;
const FONTS = `${VERSION}-fonts`;

const SHELL_URLS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './engine.js',
  './locus.js',
  './light.js',
  './selective.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './samples/neon-street.webp',
  './samples/skyline.webp',
  // The Aerospace UI Kit stylesheet lives outside this worker's scope but on the same origin.
  // A worker may cache any same-origin URL; scope only limits which pages it controls. Without
  // this entry the offline shell renders unstyled (found in the 1.0.1 review).
  '../aerospace-ui/style.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map((url) =>
      cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k !== SHELL && k !== FONTS)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isFont(url) {
  return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isFont(url)) {
    // Cache-first; the app falls back to the monospace stack offline regardless.
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', res.clone()).catch(() => {});
        return res;
      } catch (_) {
        const cache = await caches.open(SHELL);
        return (await cache.match('./index.html')) ||
               (await cache.match('./')) ||
               new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // Same-origin assets: cache-first, revalidate in the background.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req);
    if (hit) {
      fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (_) {
      return new Response('offline', { status: 503, statusText: 'offline' });
    }
  })());
});
