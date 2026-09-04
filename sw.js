/* Omarchy Radio service worker.

   Caches the shell so the deck opens instantly, works offline and meets the
   install criteria. Audio deliberately never goes near the cache: the live
   stream is an endless response, and the on-demand tracks are served as
   range requests, where storing a partial response breaks seeking.

   The podcast feed and its episodes are another origin's and are left alone
   here; the player keeps its own copy of the episode list so a link to one
   still opens offline.

   Bump VERSION to retire every old cache on the next activate. */

var VERSION = 'v2';
var SHELL = 'omarchy-radio-' + VERSION;

var ASSETS = [
  './',
  'index.html',
  'site.webmanifest',
  'assets/css/style.css',
  'assets/css/fonts.css',
  'assets/js/app.js',
  'assets/fonts/jetbrains-mono-latin.woff2',
  'assets/fonts/space-grotesk-latin.woff2',
  'assets/fonts/vt323-latin.woff2',
  'assets/images/favicon.svg',
  'assets/images/icon-192.png',
  'assets/images/icon-512.png',
  'assets/images/apple-touch-icon.png',
  'tracks/playlist.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL)
      // One miss should not fail the whole install, so each is added alone.
      .then(function (c) {
        return Promise.all(ASSETS.map(function (u) {
          return c.add(u).catch(function () { /* skip what is not there */ });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === SHELL ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  // The stream and its stats live on another origin. Leave them alone.
  if (url.origin !== self.location.origin) return;

  // Large and ranged. A cached 206 would come back as a broken track.
  if (/\.mp3$/i.test(url.pathname) || req.headers.get('range')) return;

  // Always try the network for the page itself, so a deploy is picked up
  // rather than pinned by whatever was cached first. Cache is the offline
  // fallback, not the source of truth.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(SHELL).then(function (c) { c.put('index.html', copy); });
        return r;
      }).catch(function () {
        return caches.match('index.html').then(function (hit) {
          return hit || caches.match('./');
        });
      })
    );
    return;
  }

  // Everything else: serve the cached copy at once, refresh it behind the
  // scenes, so an update lands on the following load.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.status === 200 && r.type === 'basic') {
          var copy = r.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
