// sw.js — RetroChat service worker.
//
// Strategy:
//   • install  — precache the static shell (HTML, CSS, all local JS, icons,
//                manifest) so a cold PWA launch works offline.
//   • activate — purge any cache from a previous CACHE_VERSION.
//   • fetch    — GET only.
//                  /api/*, /_vercel/*  → network only, never cached
//                  navigations         → network-first, cached shell on failure
//                  same-origin assets  → stale-while-revalidate
//                  cross-origin        → network, untouched
//   • offline  — navigations fall back to the cached index.html so the UI
//                still boots with no network.
//
// Why stale-while-revalidate rather than plain cache-first:
//
// This project has no build step, so asset URLs are unversioned — /js/chat.js
// is /js/chat.js forever. Under cache-first with no runtime writes, the ONLY
// way a client ever saw new code was a CACHE_VERSION bump, because that's
// what changes sw.js's bytes and triggers an SW update. Forget the bump and
// every returning visitor is pinned to the old build indefinitely — including
// for security fixes, which is exactly the failure mode you least want.
//
// SWR keeps the instant cache-first paint but also refetches in the
// background and updates the cache, so a client is at worst one load behind
// and heals itself. CACHE_VERSION still exists for forcing a clean slate
// (e.g. removing a file from the precache list), it's just no longer load-
// bearing for shipping ordinary code changes.

(function () {
  'use strict';

  var CACHE_VERSION = 'v11';
  var CACHE_NAME = 'retrochat-' + CACHE_VERSION;

  // Same-origin URLs MUST succeed at install or the SW won't activate.
  //
  // jQuery and marked used to be a separate best-effort CDN list, which meant
  // a cdnjs hiccup during install left the PWA cached but non-functional —
  // the shell would load and then die on `$ is not defined`. Now they're
  // ordinary same-origin assets, so they're covered by the same all-or-
  // nothing install guarantee as the rest of the app.
  var CRITICAL = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/vendor/jquery.slim.min.js',
    '/js/vendor/marked.min.js',
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
    '/icons/icon-crt.svg',
    '/icons/splash-iphone5s.png',
    '/icons/splash-iphone678.png'
  ];

  self.addEventListener('install', function (event) {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(function (cache) { return cache.addAll(CRITICAL); })
        .then(function () { return self.skipWaiting(); })
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

    // Never intercept cross-origin requests. Markdown replies can embed
    // images from arbitrary hosts; those are none of our business and
    // caching opaque responses would bloat storage for no benefit.
    if (url.origin !== self.location.origin) return;

    // Always live: SSE streams, and the analytics tracker + its beacons
    // (a cached tracker would keep reporting under a stale build).
    if (url.pathname.indexOf('/api/') === 0) return;
    if (url.pathname.indexOf('/_vercel/') === 0) return;

    // Navigations decide which build the user is on, so prefer the network
    // and only fall back to cache when offline.
    if (req.mode === 'navigate') {
      event.respondWith(networkFirst(event, req));
      return;
    }

    event.respondWith(staleWhileRevalidate(event, req));
  });

  function networkFirst(event, req) {
    return fetch(req).then(function (resp) {
      if (isCacheable(resp)) {
        var copy = resp.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
          // Store under both the requested URL and the canonical shell path,
          // so the offline fallback stays current too (cleanUrls means the
          // same document is reachable as "/" and "/index.html").
          return Promise.all([
            cache.put(req, copy.clone()),
            cache.put('/index.html', copy)
          ]);
        }).catch(function () { /* cache write is best-effort */ }));
      }
      return resp;
    }).catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || caches.match('/index.html');
      });
    });
  }

  function staleWhileRevalidate(event, req) {
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var networked = fetch(req).then(function (resp) {
          if (isCacheable(resp)) {
            cache.put(req, resp.clone()).catch(function () {});
          }
          return resp;
        }).catch(function () {
          // Offline and nothing cached — surface the failure.
          return cached || Response.error();
        });

        if (cached) {
          // Serve instantly, but keep the worker alive long enough for the
          // background refresh to land in the cache. Without waitUntil the
          // SW can be killed mid-flight and the update is silently lost.
          event.waitUntil(networked.catch(function () {}));
          return cached;
        }
        return networked;
      });
    });
  }

  // Only store complete, same-origin, successful responses. `basic` excludes
  // opaque cross-origin replies; a 404/500 must never be allowed to poison
  // the cache and outlive the outage that produced it.
  function isCacheable(resp) {
    return !!resp && resp.ok && resp.type === 'basic';
  }
})();
