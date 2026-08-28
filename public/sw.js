const CACHE = 'libposie-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/styles.css',
  '/js/app.js',
  '/js/api.js',
  '/js/ui.js',
  '/js/scanner.js',
  '/js/views/auth.js',
  '/js/views/library.js',
  '/js/views/book.js',
  '/js/views/scan.js',
  '/js/views/discover.js',
  '/js/views/loans.js',
  '/js/views/categories.js',
  '/js/views/notifications.js',
  '/js/views/settings.js',
  '/js/views/admin.js',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // API responses are always live — never serve stale library data.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('/index.html'));
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Libposie', body: '', link: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    data.body = event.data?.text() || '';
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icons/icon.svg',
        badge: '/icons/icon.svg',
        tag: data.type || 'libposie',
        data: { link: data.link || '/' }
      });
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clients.forEach((c) => c.postMessage({ type: 'notification', title: data.title }));
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  const target = new URL(link.startsWith('#') ? `/${link}` : link, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
