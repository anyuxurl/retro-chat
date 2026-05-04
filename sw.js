// sw.js — RetroChat service worker.
//
// Strategy:
//   • install  — precache the static shell (HTML, CSS, all local JS,
//                icons, manifest) plus the two CDN scripts.
//   • activate — purge any cache from a previous CACHE_VERSION.
//   • fetch    — GET only; /api/* always hits the network (SSE / AI);
//                everything else: cache-first, no runtime cache writes
//                (keeps the cache bounded to the precache list).
//   • offline  — navigation requests fall back to the cached index.html
//                so the UI still loads even with no network.
//
// To ship a new build: bump CACHE_VERSION below. The activate handler
// will delete the old cache, and clients.claim() makes the new SW
// control all open tabs immediately.

(function () {
  'use strict';

  var CACHE_VERSION = 'v2';
  var CACHE_NAME = 'retrochat-' + CACHE_VERSION;

  // Same-origin URLs MUST succeed at install or the SW won't activate.
  var CRITICAL = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/i18n.js',
    '/js/storage.js',
    '/js/stream.js',
    '/js/chat.js',
    '/js/settings.js',
    '/js/app.js',
    '/js/analytics.js',
    '/manifest.webmanifest',
    '/icons/favicon.svg',
    '/icons/favicon-16.png',
    '/icons/favicon-32.png',
    '/icons/apple-touch-icon.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-mac.svg',
    '/icons/icon-crt.svg'
  ];

  // Cross-origin (CDN) — tolerate failure so a flaky CDN doesn't brick
  // the install. They'll be cached lazily on first successful network use.
  var OPTIONAL = [
    'https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.4/jquery.slim.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/marked/4.3.0/marked.min.js'
  ];

  self.addEventListener('install', function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.addAll(CRITICAL).then(function () {
          return Promise.all(OPTIONAL.map(function (url) {
            return cache.add(url).catch(function () { /* ignore CDN failure */ });
          }));
        });
      }).then(function () { return self.skipWaiting(); })
    );
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k.indexOf('retrochat-') === 0 && k !== CACHE_NAME) {
            return caches.delete(k);
          }
          return null;
        }));
      }).then(function () { return self.clients.claim(); })
    );
  });

  self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return;

    var url;
    try { url = new URL(req.url); } catch (e) { return; }

    // /api/* must always go to network — SSE streams + real-time AI calls.
    if (url.pathname.indexOf('/api/') === 0) return;

    event.respondWith(
      caches.match(req).then(function (cached) {
        if (cached) return cached;
        return fetch(req).catch(function () {
          // Offline: serve the cached shell for navigation requests so
          // the UI at least boots; everything else surfaces the failure.
          if (req.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return Response.error();
        });
      })
    );
  });
})();
