// Service worker do Leitor: guarda o app no aparelho para funcionar offline.
const VERSION = 'leitor-v3';
const SHELL = [
  './',
  './leitor.css',
  './leitor-app.mjs',
  './leitor-core.mjs',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('leitor-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // só cuida dos arquivos do próprio app (funciona em /leitor/ ou na raiz de um domínio)
  if (!req.url.startsWith(self.registration.scope)) return;

  // Página: rede primeiro (para receber atualizações), cache como reserva.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); if (res.ok && !res.redirected) caches.open(VERSION).then((c) => c.put('./', copy)); return res; })
        .catch(() => caches.match('./')),
    );
    return;
  }
  // Demais arquivos: cache primeiro, atualizando em segundo plano.
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
      if (cached) { network.catch(() => {}); return cached; }
      return network;
    }),
  );
});
