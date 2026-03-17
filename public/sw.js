const CACHE_NAME = 'brocco-v1';
const SHELL_URLS = ['/', '/chat', '/plan', '/history', '/settings', '/legal'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_URLS).catch(() => {
        // Some pages may not be cacheable in dev, that's ok
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Don't cache API calls or POST requests
  if (url.pathname.startsWith('/api') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for the app shell
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: try cache first
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // For navigation requests, show offline page
          if (event.request.mode === 'navigate') {
            return new Response(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brocco</title><style>body{background:#030712;color:#e5e7eb;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center}.c{max-width:300px}h1{font-size:3rem;margin-bottom:0.5rem}p{color:#9ca3af;font-size:0.875rem}</style></head><body><div class="c"><h1>🥦</h1><p>You\'re offline. Check your connection and try again.</p></div></body></html>',
              { headers: { 'Content-Type': 'text/html' } }
            );
          }
          return new Response('', { status: 408 });
        });
      })
  );
});
