// Service worker: un "ayudante" que corre en segundo plano y guarda
// una copia de la app en el celular, para que abra aunque no haya señal.

// Si cambias algún archivo de la app, sube este número (v2, v3...)
// para que el celular descargue la versión nueva.
const VERSION = 'finanzas-v1';
const ARCHIVOS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icono-192.png',
  './icono-512.png',
];

// Al instalarse: descarga y guarda todos los archivos de la app.
self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ARCHIVOS))
  );
  self.skipWaiting();
});

// Al activarse: borra las copias de versiones anteriores.
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n !== VERSION).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Cada vez que la app pide un archivo: intenta internet primero
// (para tener siempre lo último) y, si no hay señal, usa la copia.
// Los envíos al Apps Script (POST) no pasan por aquí.
self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET' || new URL(pedido.url).origin !== location.origin) {
    return;
  }
  evento.respondWith(
    fetch(pedido)
      .then((respuesta) => {
        const copia = respuesta.clone();
        caches.open(VERSION).then((cache) => cache.put(pedido, copia));
        return respuesta;
      })
      .catch(() => caches.match(pedido))
  );
});
