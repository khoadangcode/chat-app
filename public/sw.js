const CACHE_NAME = 'chat-app-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json'
];

// Install — cache static assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fallback to cache (for a chat app, fresh data is important)
self.addEventListener('fetch', (e) => {
  // Skip non-GET and API/socket requests
  if (e.request.method !== 'GET' || e.request.url.includes('/api/') || e.request.url.includes('/socket.io/')) {
    return;
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Cache successful responses for static assets
        if (res.ok && STATIC_ASSETS.some(a => e.request.url.endsWith(a))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
