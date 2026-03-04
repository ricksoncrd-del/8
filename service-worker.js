/**
 * ============================================================
 *  HMFC Bible — Service Worker
 *  Harvester Mission Fellowship Church
 *  Strategy: Cache-First for app shell & Bible data,
 *             Network-First for navigation,
 *             Stale-While-Revalidate for Google Fonts.
 * ============================================================
 */

const CACHE_VERSION = 'v1';
const CACHE_APP     = `hmfc-bible-app-${CACHE_VERSION}`;
const CACHE_DATA    = `hmfc-bible-data-${CACHE_VERSION}`;
const CACHE_FONTS   = `hmfc-bible-fonts-${CACHE_VERSION}`;

// All caches managed by this SW
const ALL_CACHES = [CACHE_APP, CACHE_DATA, CACHE_FONTS];

// ── App-shell assets (cached on install) ─────────────────────
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.png'
];

// ── Large Bible data (cached on install, served cache-first) ──
const DATA_ASSETS = [
  './all-bible-versions.json'
];

// ── Google Fonts origins (stale-while-revalidate) ────────────
const FONT_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com'
];

// ============================================================
// INSTALL — pre-cache app shell & Bible data
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_APP).then(cache => {
        console.log('[SW] Pre-caching app shell');
        return cache.addAll(APP_SHELL);
      }),
      caches.open(CACHE_DATA).then(cache => {
        console.log('[SW] Pre-caching Bible data');
        return cache.addAll(DATA_ASSETS);
      })
    ])
    .then(() => {
      console.log('[SW] Install complete — skipping waiting');
      return self.skipWaiting();
    })
    .catch(err => {
      console.error('[SW] Install failed:', err);
    })
  );
});

// ============================================================
// ACTIVATE — clean up old caches from previous versions
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => !ALL_CACHES.includes(key))
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      );
    })
    .then(() => {
      console.log('[SW] Activated — claiming clients');
      return self.clients.claim();
    })
  );
});

// ============================================================
// FETCH — routing logic
// ============================================================
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── 1. Google Fonts — Stale-While-Revalidate ─────────────
  if (FONT_ORIGINS.some(origin => request.url.startsWith(origin))) {
    event.respondWith(staleWhileRevalidate(request, CACHE_FONTS));
    return;
  }

  // ── 2. Bible JSON data — Cache-First ─────────────────────
  if (url.pathname.endsWith('all-bible-versions.json')) {
    event.respondWith(cacheFirst(request, CACHE_DATA));
    return;
  }

  // ── 3. App shell / static assets — Cache-First ───────────
  if (
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js')   ||
    url.pathname.endsWith('.css')  ||
    url.pathname.endsWith('.png')  ||
    url.pathname.endsWith('.jpg')  ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg')  ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.ico')  ||
    url.pathname.endsWith('.json') ||
    url.pathname === '/'
  ) {
    event.respondWith(cacheFirst(request, CACHE_APP));
    return;
  }

  // ── 4. Navigation requests — Network-First ────────────────
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, CACHE_APP));
    return;
  }

  // ── 5. Everything else — Network with cache fallback ──────
  event.respondWith(networkWithCacheFallback(request, CACHE_APP));
});

// ============================================================
// STRATEGIES
// ============================================================

/**
 * Cache-First
 * Serve from cache; if missing, fetch, cache, and return.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache-First: network failed for', request.url);
    return offlineFallback();
  }
}

/**
 * Network-First
 * Try network; on failure serve from cache; last resort: offline page.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    // For navigation, serve index.html as SPA shell
    const shell = await cache.match('./index.html')
               || await cache.match('./');
    if (shell) return shell;
    return offlineFallback();
  }
}

/**
 * Stale-While-Revalidate
 * Serve from cache immediately while updating cache in background.
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Kick off network fetch in background
  const fetchPromise = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await fetchPromise;
}

/**
 * Network with Cache Fallback
 * Try network first, serve cache on failure.
 */
async function networkWithCacheFallback(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

/**
 * Offline Fallback
 * Returns a minimal offline HTML page when no cache is available.
 */
function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HMFC Bible — Offline</title>
  <style>
    body {
      background: #0e1117; color: #e8e4d9;
      font-family: Georgia, serif;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; text-align: center; padding: 20px;
    }
    .cross { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; color: #c9a84c; margin-bottom: 8px; }
    p  { font-size: 14px; color: #a89f8c; line-height: 1.6; max-width: 320px; }
    .verse { font-style: italic; color: #c9a84c; margin-top: 24px; font-size: 13px; }
    button {
      margin-top: 20px; padding: 10px 24px;
      background: #c9a84c; color: #0e0e0e;
      border: none; border-radius: 8px;
      font-size: 14px; font-weight: 600; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="cross">✝</div>
  <h1>You are offline</h1>
  <p>No internet connection detected. Please reconnect to continue using the HMFC Bible app.</p>
  <p class="verse">"Your word is a lamp to my feet and a light to my path." — Psalm 119:105</p>
  <button onclick="location.reload()">Try Again</button>
</body>
</html>`,
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }
  );
}

// ============================================================
// MESSAGE — allow pages to trigger cache clear / skip waiting
// ============================================================
self.addEventListener('message', event => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys =>
        Promise.all(keys.map(key => caches.delete(key)))
      ).then(() => {
        event.source && event.source.postMessage({ type: 'CACHE_CLEARED' });
      })
    );
  }
});
