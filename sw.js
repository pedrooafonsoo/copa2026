// Service worker — deixa o app abrir mesmo sem internet.
// Estratégia: o "casco" do app (HTML, CSS, JS, ícones) fica em cache;
// as chamadas a /api/ vão sempre à rede (placar precisa ser fresco).
const CACHE = 'copa-milena-v2';
const CASCO = [
  './', 'index.html', 'css/estilo.css', 'js/app.js', 'js/dados.js',
  'manifest.webmanifest', 'icons/icone-192.png', 'icons/icone-512.png', 'icons/icone-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCO)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((chaves) =>
    Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // placar: sempre rede
  // casco: cache primeiro, com atualização silenciosa em segundo plano
  e.respondWith(
    caches.match(e.request).then((emCache) => {
      const daRede = fetch(e.request).then((resposta) => {
        if (resposta.ok && url.origin === location.origin) {
          const copia = resposta.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resposta;
      }).catch(() => emCache);
      return emCache || daRede;
    })
  );
});
