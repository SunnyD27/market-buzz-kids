/* public/sw.js — Market Juice service worker.
 *
 * Strategy:
 *   - App shell (CSS/JS/icons/fonts) — cache-first. These rarely change;
 *     the cache name is versioned so we bust them on bumps.
 *   - Digest HTML (/, /index.html) — network-first with cache fallback.
 *     Always try fresh first so the kid sees today's digest; if offline,
 *     show the last cached one. Better than a generic offline page.
 *   - Game data JSON — network-first, cached for offline.
 *   - Everything else — pass through (default fetch).
 *
 * Push notifications — handles incoming pushes from the Phase 6 backend
 * (Web Push API + VAPID). Click on notification opens / focuses the digest.
 */

// Bumped to v2 + renamed `mb-` → `mj-` prefix for the Market Juice rebrand
// (was Market Buzz Kids). The activate handler below explicitly deletes any
// leftover `mb-*` caches so kids who had the PWA installed pre-rebrand get
// fresh assets on their next visit instead of stale branded content.
const VERSION = 'v2';
const SHELL_CACHE = 'mj-shell-' + VERSION;
const RUNTIME_CACHE = 'mj-runtime-' + VERSION;

// App shell: static assets the digest depends on. Pre-cached on SW install
// so the first PWA open works offline immediately.
const SHELL_ASSETS = [
  '/engagement.css',
  '/engagement.js',
  '/games/styles.css',
  '/games/shared.js',
  '/games/compound.js',
  '/games/match.js',
  '/games/time-machine.js',
  '/games/bull-bear.js',
  '/games/price-is-right.js',
  '/games/daily-challenge.js',
  '/pwa.js',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Use individual adds so one missing asset doesn't fail the whole install.
    await Promise.all(SHELL_ASSETS.map(async (url) => {
      try { await cache.add(url); }
      catch (e) { console.warn('[SW] Failed to precache', url, e); }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Reap old versioned caches. Includes legacy `mb-*` caches from the
    // pre-rebrand Market Buzz Kids days, plus any `mj-*` caches that
    // aren't the current ones.
    const names = await caches.keys();
    await Promise.all(
      names
        .filter(n => (n.startsWith('mb-') || n.startsWith('mj-'))
                     && n !== SHELL_CACHE && n !== RUNTIME_CACHE)
        .map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GETs from same-origin. Cross-origin (fonts.googleapis.com etc.)
  // and POSTs (push subscription) pass through.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Digest HTML — network-first with cache fallback.
  // We detect "digest" by either the root path or any .html document request.
  const isHTMLDoc = req.mode === 'navigate'
    || (req.headers.get('accept') || '').includes('text/html')
    || url.pathname === '/'
    || url.pathname.endsWith('.html');

  if (isHTMLDoc) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // Game data JSON — network-first, cached for offline use.
  if (url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(req, RUNTIME_CACHE));
    return;
  }

  // Shell assets (precached) — cache-first.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }

  // Everything else — try network, fall back to cache if available.
  event.respondWith(networkFirst(req, RUNTIME_CACHE));
});

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    // Only cache successful, basic responses to avoid caching errors / opaque.
    if (fresh && fresh.ok && fresh.type !== 'opaque') {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    // For navigation requests with no cache, return a tiny offline shell.
    if (req.mode === 'navigate') {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Market Juice — Offline</title>'
        + '<style>body{background:#0d1117;color:#e6edf3;font-family:system-ui,sans-serif;'
        + 'display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px;}'
        + 'h1{font-size:32px;margin-bottom:8px;} p{color:#8b949e;}</style></head>'
        + '<body><div><h1>📈 You\'re offline</h1>'
        + '<p>Connect to the internet to see today\'s digest.</p></div></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh && fresh.ok && fresh.type !== 'opaque') {
    const cache = await caches.open(cacheName);
    cache.put(req, fresh.clone());
  }
  return fresh;
}

/* ---- Push notifications ---- */

self.addEventListener('push', (event) => {
  // Phase 6 backend will send a JSON payload like:
  //   { title: "📈 Today's Buzz is ready!", body: "Today's mover: Nike -4.2%", url: "/" }
  let payload = {};
  if (event.data) {
    try { payload = event.data.json(); }
    catch { payload = { title: 'Market Juice', body: event.data.text() }; }
  }
  const title = payload.title || '📈 Today\'s Market Juice is ready';
  const opts = {
    body: payload.body || 'Open the digest to play today\'s games.',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    tag: 'mj-daily', // collapses prior notifications onto this one
    renotify: true,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Prefer focusing an existing window if one is already open.
    for (const c of all) {
      try {
        const u = new URL(c.url);
        if (u.origin === self.location.origin) {
          await c.focus();
          // Navigate to the target if needed.
          if (c.navigate && new URL(c.url).pathname !== targetUrl) {
            try { await c.navigate(targetUrl); } catch { /* ignore */ }
          }
          return;
        }
      } catch { /* skip */ }
    }
    // Otherwise open a fresh window.
    await self.clients.openWindow(targetUrl);
  })());
});
