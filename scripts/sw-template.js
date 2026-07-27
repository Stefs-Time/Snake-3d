/**
 * Neon Cabinet service worker.
 *
 * This file is a template. The two placeholder tokens below (the build version
 * and the precache list) are substituted by the Vite plugin in vite.config.js,
 * which walks the real output directory. That means every hashed asset —
 * including each game's lazily loaded chunk and the Three.js bundle — is cached
 * during install, so the whole arcade genuinely works offline after the first
 * visit, not just the pages you happened to open.
 *
 * Note for editors: do not write either token anywhere else in this file. The
 * substitution is textual, and a mention in a comment would be replaced too.
 */

const VERSION = '__VERSION__';
const CACHE = `neon-cabinet-${VERSION}`;
const PRECACHE = __PRECACHE__;

/* ============================================================== install == */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll fails the whole install if any single request fails, so add
      // individually and tolerate the odd miss.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      );
    })(),
  );
});

/* ============================================================= activate == */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith('neon-cabinet-') && name !== CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/* ================================================================ fetch == */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Leaderboards must never be served stale — they simply fail when offline.
  if (url.pathname.startsWith('/api/')) return;

  // Client-side routes: try the network, fall back to the cached shell so a
  // deep link like /play/chomp still opens on a plane.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put('/index.html', response.clone());
          return response;
        } catch {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('/index.html')) ||
            (await cache.match('/')) ||
            new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain' } })
          );
        }
      })(),
    );
    return;
  }

  // Everything else: serve from cache immediately, refresh in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);

      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      return cached || (await network) || new Response('', { status: 504 });
    })(),
  );
});
