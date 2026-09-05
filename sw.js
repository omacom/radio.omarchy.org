/* Omarchy Radio service worker.

   Caches the shell so the deck opens instantly, works offline and meets the
   install criteria. Audio deliberately never goes near the cache: the tracks
   are served as range requests, and storing a partial response breaks
   seeking.

   The podcast feed is served from here now, mirrored hourly by a workflow, so
   it is cached like the playlist and an episode list is there offline. The
   episode audio is the show's host's and is left alone, like the tracks.

   Every song and every episode is a page of its own, written by
   tools/build-routes.py. There are too many to precache and no reason to:
   a page is cached the first time it is opened, and any page never opened
   falls back to the shell, which reads the address and routes itself. Paths
   are written from the site root here, as they are everywhere else, because
   a page at /playlist/<song> would resolve a relative one against
   /playlist/.

   Bump VERSION to retire every old cache on the next activate. */

var VERSION = 'v5';
var SHELL = 'omarchy-radio-' + VERSION;
var PAGE = '/index.html';

var ASSETS = [
  '/',
  PAGE,
  '/playlist',
  '/podcast',
  '/site.webmanifest',
  /* The deck and its stylesheets are deliberately not here. Their addresses
     carry a stamp of their contents, written by tools/build-routes.py, so
     they cannot be listed by name from in here — and do not need to be: a
     stamped address is cached the first time a page asks for it, and a
     changed file is a new address that misses and goes to the network. That
     is what keeps a cached deck from ever being served against a page it no
     longer fits. */
  '/assets/fonts/jetbrains-mono-latin.woff2',
  '/assets/fonts/space-grotesk-latin.woff2',
  '/assets/fonts/vt323-latin.woff2',
  '/assets/images/favicon.svg',
  '/assets/images/icon-192.png',
  '/assets/images/icon-512.png',
  '/assets/images/apple-touch-icon.png',
  '/tracks/playlist.json',
  '/stories/feed.rss'
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

  // The episode audio lives on another origin. Leave it alone.
  if (url.origin !== self.location.origin) return;

  // Large and ranged. A cached 206 would come back as a broken track.
  if (/\.mp3$/i.test(url.pathname) || req.headers.get('range')) return;

  /* Always try the network for a page, so a deploy is picked up rather than
     pinned by whatever was cached first, and keep the copy that comes back
     under its own address: the page for a song is not the page for the deck.
     Offline, the page itself if it has been opened before, and the shell if
     it has not — the shell reads the address and routes to the same place. */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        if (r && r.status === 200 && r.type === 'basic') {
          var copy = r.clone();
          caches.open(SHELL).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () {
        return caches.match(req, { ignoreSearch: true }).then(function (hit) {
          if (hit) return hit;
          return caches.match(PAGE).then(function (shell) {
            return shell || caches.match('/');
          });
        });
      })
    );
    return;
  }

  // Everything else: serve the cached copy at once, refresh it behind the
  // scenes, so an update lands on the following load. Matching includes the
  // query, which is what makes a stamped address miss when the file changes.
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
