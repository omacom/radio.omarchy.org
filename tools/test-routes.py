#!/usr/bin/env python3

"""Checks that every permalink is a page, and that the deck agrees with it.

    python3 tools/test-routes.py            run the checks
    python3 tools/test-routes.py --serve    serve the tree the way the host does

Four things can go wrong with routing on a static host, and each one of them
is silent:

  1. A slug the build writes a page under is not the slug the deck computes,
     so the link opens a page for a song the deck cannot find. The two
     implementations are run over the same titles and compared.

  2. A page is missing, stale, or left over from a song that was renamed.
     build-routes.py --check answers that.

  3. An address that ought to serve a page does not. Every route is asked for
     over HTTP, through a server that resolves paths — and answers byte
     ranges — the way GitHub Pages does, and the answer has to be the right
     page: its own title, its own canonical link, its own item baked into it.

  4. A link in a page points at an address that is not served. Every internal
     href in every generated page is followed.

It serves the working tree, so it tests what would be pushed. Standard
library, plus node for the slug comparison (skipped, loudly, without it).
"""

import http.server
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

build = __import__('importlib.util', fromlist=['util'])
spec = build.spec_from_file_location('build_routes', os.path.join(ROOT, 'tools', 'build-routes.py'))
B = build.module_from_spec(spec)
spec.loader.exec_module(B)

PORT = int(os.environ.get('PORT', '8901'))
BASE = 'http://127.0.0.1:%d' % PORT

fails = []
checks = [0]


def ok(condition, message):
    checks[0] += 1
    if not condition:
        fails.append(message)
    return condition


# ── a server that resolves paths the way GitHub Pages does ──────────────
# Confirmed against the live site: /index serves index.html, so an
# extensionless path is served from <path>.html. Anything with no file
# behind it gets 404.html, with a 404, which is the fallback the deck routes
# out of.

class Pages(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        rel = path.split('?', 1)[0].split('#', 1)[0].lstrip('/')
        rel = urllib.request.url2pathname(rel)
        full = os.path.join(ROOT, rel)
        if os.path.isdir(full):
            index = os.path.join(full, 'index.html')
            if os.path.exists(index):
                return index
        if os.path.isfile(full):
            return full
        if os.path.isfile(full + '.html'):
            return full + '.html'
        return os.path.join(ROOT, '404.html')

    def send_head(self):
        served = self.translate_path(self.path)
        if os.path.basename(served) == '404.html' and self.path.rstrip('/') not in ('', '/404'):
            self.send_response(404)
            self.send_header('Content-Type', 'text/html')
            body = open(served, 'rb').read()
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            return io.BytesIO(body)
        part = self.ranged(served)
        return part if part is not None else super().send_head()

    def ranged(self, served):
        """A byte range, the way the host answers one.

        A browser seeking in a track asks for the middle of a file, and a
        media element only ever buffers a little way ahead — so a server that
        answers the whole file to every request is a server the deck cannot
        seek on. GitHub Pages does support ranges; without this, the one thing
        that differs is the thing under test.
        """
        head = (self.headers.get('Range') or '').strip()
        if not head or not os.path.isfile(served):
            return None
        m = re.match(r'^bytes=(\d*)-(\d*)$', head)
        if not m or not (m.group(1) or m.group(2)):
            return None

        size = os.path.getsize(served)
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start = size - int(m.group(2))  # the last N bytes
            end = size - 1
        start, end = max(0, start), min(end, size - 1)

        if start > end or start >= size:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return io.BytesIO(b'')

        with open(served, 'rb') as f:
            f.seek(start)
            body = f.read(end - start + 1)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(served))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def end_headers(self):
        # So a browser knows it may ask for the middle of a file at all.
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def log_message(self, *args):
        pass


def serve():
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Pages)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def get(path):
    try:
        with urllib.request.urlopen(BASE + path, timeout=10) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except OSError as e:
        return 0, str(e)


def meta(body, name, attr='name'):
    m = re.search(r'<meta %s="%s" content="([^"]*)"' % (attr, re.escape(name)), body)
    return m.group(1) if m else ''


def title(body):
    m = re.search(r'<title>([^<]*)</title>', body)
    return m.group(1) if m else ''


def canonical(body):
    m = re.search(r'<link rel="canonical" href="([^"]*)"', body)
    return m.group(1) if m else ''


def seed(body):
    m = re.search(r'window\.__ITEM__ = (\{.*?\});', body, re.S)
    return json.loads(m.group(1).replace('\\u003c', '<')) if m else None


# ── 1. the two implementations of the slug ──────────────────────────────

JS_PROBE = r'''
const fs = require('fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
// Lift the two functions out of the deck rather than copying them: a copy is
// the thing this test exists to catch.
function lift(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('no ' + name + '() in app.js');
  let depth = 0, i = src.indexOf('{', at);
  const start = at;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(name + '() never closes');
}
const fn = new Function(lift('slugify') + '\n' + lift('assignSlugs') +
  '\nreturn function (items, kind) { assignSlugs(items, kind); return items; };')();
const items = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
console.log(JSON.stringify(fn(items.list, items.kind).map(t => t.key)));
'''


def slug_parity(tracks, eps):
    node = shutil.which('node')
    if not node:
        print('  ! node not found: the slug comparison did not run')
        return

    # The real titles, plus the shapes that have broken a slug before: accents,
    # both apostrophes, punctuation only, a duplicate title, and the names of
    # things that live on Object.prototype.
    extra = [
        {'title': 'Aurélien’s Café', 'artist': 'Zoë'},
        {'title': "It's fucking fork o'clock", 'artist': 'Boyd'},
        {'title': '!!!', 'artist': 'Nobody'},
        {'title': 'Quattro!', 'artist': 'One'},
        {'title': 'Quattro!', 'artist': 'Two'},
        {'title': 'Quattro!', 'artist': 'Two'},
        {'title': 'constructor', 'artist': 'A'},
        {'title': 'toString', 'artist': 'B'},
        {'title': '__proto__', 'artist': 'C'},
        {'title': 'hasOwnProperty', 'artist': 'D'},
        {'title': 'ÅSA — Ünïcödé Overload', 'artist': 'É'},
        {'title': '  spaced  out  ', 'artist': 'E'},
    ]

    for kind, rows in (('playlist', [dict(t) for t in tracks] + extra),
                       ('podcast', [dict(e) for e in eps] + extra)):
        probe = os.path.join(ROOT, '.slug-probe.json')
        js = os.path.join(ROOT, '.slug-probe.js')
        try:
            with open(probe, 'w', encoding='utf-8') as f:
                json.dump({'list': [{'title': r['title'], 'artist': r.get('artist', '')}
                                    for r in rows], 'kind': kind}, f, ensure_ascii=False)
            with open(js, 'w', encoding='utf-8') as f:
                f.write(JS_PROBE)
            out = subprocess.run([node, js, os.path.join(ROOT, 'assets/js/app.js'), probe],
                                 capture_output=True, text=True, cwd=ROOT)
            if out.returncode != 0:
                ok(False, 'the deck\'s slugify could not be run: %s' % out.stderr.strip())
                continue
            from_js = json.loads(out.stdout)
        finally:
            for f in (probe, js):
                if os.path.exists(f):
                    os.remove(f)

        mine = [t['key'] for t in B.assign_slugs([dict(r) for r in rows], kind)]
        ok(len(from_js) == len(mine), '%s: the deck slugged %d titles, the build %d'
           % (kind, len(from_js), len(mine)))
        for a, b, r in zip(from_js, mine, rows):
            ok(a == b, 'slug disagreement on %r: the deck says %s, the build says %s'
               % (r['title'], a, b))
        print('  %s: %d titles, same slug from both' % (kind, len(mine)))


# ── the run ─────────────────────────────────────────────────────────────

def main():
    # tools/test-browser.mjs drives a real browser against this same server,
    # so that what it sees resolves paths the way the host will.
    if '--serve' in sys.argv:
        serve()
        print('serving %s at %s' % (ROOT, BASE), flush=True)
        threading.Event().wait()
        return 0

    print('building the pages the sources ask for', flush=True)
    if subprocess.run([sys.executable, os.path.join(ROOT, 'tools/build-routes.py'), '--check'],
                      cwd=ROOT).returncode != 0:
        fails.append('the pages on disk are not what the sources say they should be')

    tracks = B.read_tracks()
    show, home, eps = B.read_episodes()
    print('%d songs, %d episodes' % (len(tracks), len(eps)))

    print('comparing the slugs the deck computes with the ones the build wrote')
    slug_parity(tracks, eps)

    httpd = serve()
    try:
        print('asking for every route')
        routes = ['/', '/playlist', '/podcast']
        for t in tracks:
            routes.append('/' + t['key'])
        for e in eps:
            routes.append('/' + e['key'])

        for path in routes:
            status, body = get(path)
            if not ok(status == 200, '%s answered %s, not 200' % (path, status)):
                continue
            ok(canonical(body) == B.CANON + path,
               '%s: canonical is %r' % (path, canonical(body)))
            ok(meta(body, 'og:url', 'property') == B.CANON + path,
               '%s: og:url is %r' % (path, meta(body, 'og:url', 'property')))
            ok('<!-- page:head -->' in body and '<!-- page:list -->' in body,
               '%s: the markers are gone' % path)
            ok('noindex' not in meta(body, 'robots'), '%s: not indexable' % path)
            ok('/assets/js/app.js' in body, '%s: does not load the deck' % path)

        # The pages behind a permalink: their own title, and their own item.
        for item in tracks + eps:
            path = '/' + item['key']
            status, body = get(path)
            s = seed(body)
            if not ok(s is not None, '%s: no item baked in' % path):
                continue
            ok(s.get('slug') == item['slug'],
               '%s: the item baked in is %r' % (path, s.get('slug')))
            ok(s.get('kind') == item['kind'], '%s: wrong kind baked in' % path)
            ok(s.get('title') == item['title'], '%s: wrong title baked in' % path)
            ok(item['title'] in title(body), '%s: the title tag is %r' % (path, title(body)))
            if item['kind'] == 'playlist':
                ok(s.get('file') == item.get('file'), '%s: wrong file baked in' % path)
            else:
                ok(s.get('url') == item['url'], '%s: wrong audio url baked in' % path)
            ok(('href="%s"' % path) in body, '%s: the page does not link to itself' % path)

        # Home and the two lists carry the whole list, which is how a crawler
        # reaches every song without a sitemap.
        status, body = get('/playlist')
        for t in tracks:
            ok(('href="/%s"' % t['key']) in body, '/playlist does not link to %s' % t['key'])
        status, body = get('/podcast')
        for e in eps:
            ok(('href="/%s"' % e['key']) in body, '/podcast does not link to %s' % e['key'])
        status, body = get('/')
        rows = len(re.findall(r'class="track[ "]', body))
        ok(rows == len(tracks),
           '/ prerenders %d rows for %d songs' % (rows, len(tracks)))

        print('following every link in every page')
        seen = set()
        for path in routes:
            _, body = get(path)
            for href in set(re.findall(r'href="(/[^"#]*)"', body)):
                if href in seen:
                    continue
                seen.add(href)
                status, _ = get(href)
                ok(status == 200, '%s links to %s, which answered %s' % (path, href, status))
        print('  %d distinct internal links, all served' % len(seen))

        print('the spellings a link gets typed in')
        for path, why in [('/playlist/still-licensed/', 'a trailing slash'),
                          ('/playlist/still-licensed.html', 'the file itself'),
                          ('/PLAYLIST/STILL-LICENSED', 'shouted'),
                          ('/playlist/nope-not-a-song', 'a song that is not there'),
                          ('/nonsense/at/all', 'nonsense')]:
            status, body = get(path)
            ok(status in (200, 404), '%s (%s) answered %s' % (path, why, status))
            ok('/assets/js/app.js' in body,
               '%s (%s) did not come back as something the deck can route' % (path, why))

        print('the sitemap')
        _, sm = get('/sitemap.xml')
        for path in routes:
            ok(('<loc>%s</loc>' % (B.CANON + path)) in sm, 'the sitemap is missing %s' % path)
        ok(sm.count('<loc>') == len(routes),
           'the sitemap has %d entries for %d routes' % (sm.count('<loc>'), len(routes)))

        print('the 404 page')
        status, body = get('/definitely-not-here')
        ok(status == 404, 'an unknown address answered %s, not 404' % status)
        ok('noindex' in meta(body, 'robots'), 'the 404 page is indexable')
    finally:
        httpd.shutdown()

    print('\n%d checks' % checks[0])
    if fails:
        print('%d FAILED:' % len(fails))
        for f in fails[:40]:
            print('  - %s' % f)
        if len(fails) > 40:
            print('  ... and %d more' % (len(fails) - 40))
        return 1
    print('all passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
