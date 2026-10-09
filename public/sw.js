// Service worker: nic nie zapisuje offline, tylko
// 1) pozwala Chrome rozpoznać stronę jako aplikację do zainstalowania,
// 2) przy każdym otwarciu sprawdza, czy strona się nie zmieniła (bez czekania 10 minut na pamięć GitHub Pages).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => fetch(req)));
});
