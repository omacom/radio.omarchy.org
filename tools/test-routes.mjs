/* Checks that every permalink is a page, and that the deck agrees with it.
 *
 *     node tools/test-routes.mjs            build, then run the checks
 *     node tools/test-routes.mjs --serve    serve dist/ the way the host does
 *     node tools/test-routes.mjs --no-build check what is already in dist/
 *
 * Four things can go wrong with routing on a static host, and each one of
 * them is silent:
 *
 *   1. A slug a page is written under is not the slug the deck computes, so
 *      the link opens a page for a song the deck cannot find. There is one
 *      implementation of the rule now — src/lib/slug.ts, imported by the
 *      build and by the deck — so what is left to check is that it holds up
 *      against the shapes that have broken it before, and that the files in
 *      dist/ are named by it.
 *
 *   2. A page is missing, or left over from a song that was renamed. Astro
 *      writes dist/ from scratch, so a rename cannot leave anything behind;
 *      what is checked is that every item has its page and nothing else does.
 *
 *   3. An address that ought to serve a page does not. Every route is asked
 *      for over HTTP, through a server that resolves paths — and answers byte
 *      ranges — the way GitHub Pages does, and the answer has to be the right
 *      page: its own title, its own canonical link, its own item baked in.
 *
 *   4. A link in a page points at an address that is not served. Every
 *      internal href in every generated page is followed.
 *
 * It serves dist/, so it tests what would be deployed. No dependencies.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFileSync } from 'node:fs';
import { assignSlugs, fold, slugify } from '../src/lib/slug.ts';
import { SKINS, derive } from '../src/scripts/theme.ts';
import { ICONS } from '../src/lib/icons.ts';
/* The parsing, not the reading: the build imports the manifest and the feed
   through Vite, which plain node knows nothing about. This is the same code
   over the same two files. */
import { parseEpisodes, parseTracks } from '../src/lib/lists.ts';
import { CANON } from '../src/lib/site.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8901);
const BASE = `http://127.0.0.1:${PORT}`;

const readFileSyncText = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const fails = [];
let checks = 0;

function ok(condition, message) {
  checks++;
  if (!condition) fails.push(message);
  return condition;
}

/* ── a server that resolves paths the way GitHub Pages does ──────────────
   Confirmed against the live site: /index serves index.html, so an
   extensionless path is served from <path>.html. Anything with no file
   behind it gets 404.html, with a 404, which is the fallback the deck
   routes out of. */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.rss': 'application/rss+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
};

function resolve(pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname.split('?')[0].split('#')[0]).replace(/^\/+/, '');
  } catch {
    rel = pathname.replace(/^\/+/, '');
  }
  // No climbing out of dist/.
  const full = join(DIST, rel);
  if (!full.startsWith(DIST)) return { file: join(DIST, '404.html'), found: false };

  if (existsSync(full) && statSync(full).isDirectory()) {
    const index = join(full, 'index.html');
    if (existsSync(index)) return { file: index, found: true };
  }
  if (existsSync(full) && statSync(full).isFile()) return { file: full, found: true };
  if (existsSync(`${full}.html`)) return { file: `${full}.html`, found: true };
  return { file: join(DIST, '404.html'), found: false };
}

/* A browser seeking in a track asks for the middle of a file, and a media
   element only ever buffers a little way ahead — so a server that answers the
   whole file to every request is a server the deck cannot seek on. GitHub
   Pages does support ranges; without this, the one thing that differs is the
   thing under test. */
function range(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start;
  let end;
  if (m[1]) {
    start = Number(m[1]);
    end = m[2] ? Number(m[2]) : size - 1;
  } else {
    start = size - Number(m[2]); // the last N bytes
    end = size - 1;
  }
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  return { start, end, bad: start > end || start >= size };
}

function serve() {
  const server = createServer((req, res) => {
    const { file, found } = resolve(new URL(req.url, BASE).pathname);
    const type = TYPES[extname(file)] || 'application/octet-stream';
    const size = statSync(file).size;
    res.setHeader('Accept-Ranges', 'bytes');

    const asked = range(req.headers.range, size);
    if (asked?.bad) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Content-Length': 0 });
      res.end();
      return;
    }
    if (asked) {
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Range': `bytes ${asked.start}-${asked.end}/${size}`,
        'Content-Length': asked.end - asked.start + 1,
      });
      createReadStream(file, { start: asked.start, end: asked.end }).pipe(res);
      return;
    }
    res.writeHead(found ? 200 : 404, { 'Content-Type': type, 'Content-Length': size });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  });
  return new Promise((done) => server.listen(PORT, '127.0.0.1', () => done(server)));
}

async function get(path) {
  try {
    const r = await fetch(BASE + path, { redirect: 'manual' });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { status: 0, body: String(e) };
  }
}

/* ── reading a page back ── */

const meta = (body, name, attr = 'name') => {
  const m = new RegExp(`<meta ${attr}="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" content="([^"]*)"`).exec(body);
  return m ? unentity(m[1]) : '';
};
/* Astro escapes text content, so a song with an apostrophe in it arrives as
   &#39; — correct HTML that a browser and a scraper both read back as "'".
   What is under test is what the page says, not how it spells it. */
const unentity = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos);/g,
           (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e]);
const title = (body) => unentity((/<title>([^<]*)<\/title>/.exec(body) ?? [, ''])[1]);
const canonical = (body) => (/<link rel="canonical" href="([^"]*)"/.exec(body) ?? [, ''])[1];
const seed = (body) => {
  const m = /window\.__ITEM__ = (\{[\s\S]*?\});/.exec(body);
  return m ? JSON.parse(m[1].replaceAll('\\u003c', '<')) : null;
};
/* The deck is bundled and named by a stamp of its contents, so a page loads
   it by an address that changes when it does. This is that address. */
const loadsDeck = (body) => /<script type="module" src="\/_astro\/[^"]+\.js">/.test(body);

/* ── 1. the rule an address is spelled by ──────────────────────────────── */

/* The shapes that have broken a slug before: accents, both apostrophes,
   punctuation only, a duplicate title, and the names of things that live on
   Object.prototype — a bare {} would inherit "constructor" and the rest, so a
   song by that name would read as a clash with something that is not there. */
const ADVERSARIAL = [
  { title: 'Aurélien’s Café', artist: 'Zoë', key: 'playlist/aureliens-cafe' },
  { title: "It's fucking fork o'clock", artist: 'Boyd', key: 'playlist/its-fucking-fork-oclock' },
  { title: '!!!', artist: 'Nobody', key: 'playlist/track' },
  { title: 'Quattro!', artist: 'One', key: 'playlist/quattro' },
  { title: 'Quattro!', artist: 'Two', key: 'playlist/quattro-two' },
  { title: 'Quattro!', artist: 'Two', key: 'playlist/quattro-2' },
  { title: 'constructor', artist: 'A', key: 'playlist/constructor' },
  { title: 'toString', artist: 'B', key: 'playlist/tostring' },
  { title: '__proto__', artist: 'C', key: 'playlist/proto' },
  { title: 'hasOwnProperty', artist: 'D', key: 'playlist/hasownproperty' },
  { title: 'ÅSA — Ünïcödé Overload', artist: 'É', key: 'playlist/asa-unicode-overload' },
  { title: '  spaced  out  ', artist: 'E', key: 'playlist/spaced-out' },
];

/* The stylesheet's :root block is the theme the page wears for the one frame
   before the deck has run. It is a copy of what derive() gives for the first
   skin, and a copy drifts: twelve of them were wrong, quietly, because
   nothing had ever compared the two. This is that comparison. */
function fallbackRule() {
  const css = readFileSyncText('src/styles/style.css');
  const deck = readFileSyncText('src/scripts/deck.ts');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const green = derive(SKINS[0]);

  /* Which properties matter is not a list to keep by hand either: it is
     whatever applyTheme() writes, read out of the deck. */
  const written = [...deck.matchAll(/setProperty\('(--[a-zA-Z-]+)', k\.([a-zA-Z0-9]+)\)/g)];
  ok(written.length > 15, `applyTheme() writes ${written.length} theme properties, which is too few to be right`);

  for (const [, prop, key] of written) {
    const want = green[key];
    if (typeof want !== 'string' || !/^#[0-9a-f]{6}$/.test(want)) continue; // not a colour
    const found = new RegExp(`\\${prop}:\\s*(#[0-9a-f]{6})`).exec(root);
    if (!ok(found, `:root has no fallback for ${prop}, which applyTheme() writes`)) continue;
    ok(found[1] === want,
       `:root says ${prop} is ${found[1]}, but the first skin derives ${want}`);
  }
  console.log(`  ${written.length} theme properties, every fallback matching what it derives`);
}

/* What somebody types, against what they type it at. The pairs that matter
   are the ones where the two spellings differ. */
const FOLDS = [
  ['Aurélien', 'aurelien'],
  ["Omarchee, c'est la vie", 'omarchee, cest la vie'],
  ['It\u2019s Not Omarchy, It\u2019s Me', 'its not omarchy, its me'],
  ['  spaced   OUT  ', 'spaced out'],
  ['ÅSA — Ünïcödé', 'asa — unicode'],
];

function foldRule() {
  for (const [raw, want] of FOLDS) {
    ok(fold(raw) === want, `${JSON.stringify(raw)} folds to ${JSON.stringify(fold(raw))}, not ${JSON.stringify(want)}`);
  }
  // A query is matched with indexOf against the folded row, so a fold that
  // let an accent through would be a song nobody can find.
  ok(fold('Aurélien - Omarchee, c’est la vie').includes(fold('aurelien')),
     'a folded query does not find its folded row');
  ok(fold(undefined) === '' && fold(null) === '', 'fold does not survive nothing');
  console.log(`  ${FOLDS.length} spellings, all folded to what a query would be`);
}

/* The characters the deck used to draw its controls with. Every one of them
   falls outside latin and latin-ext, which is all this site ships. */
const GLYPHS = new Set('\u25b6\u25c0\u25a0\u2759\u25bc\u25b2\u25be\u25b8\u2197');

function iconRule() {
  // The four the transport needs, both faces of the two that have two, and
  // the arrow that says a link leaves the site.
  for (const name of ['play', 'pause', 'stop', 'prev', 'next',
                      'caret-down', 'caret-up', 'caret-right', 'arrow-ne']) {
    ok(ICONS[name], `there is no icon called ${name}`);
  }
  for (const [name, icon] of Object.entries(ICONS)) {
    ok(icon.cells.length > 0, `${name} is an empty icon`);
    ok(icon.w > 0 && icon.h > 0, `${name} has no box`);
    for (const [x, y, w, h] of icon.cells) {
      ok(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && Number.isInteger(h),
         `${name} has a cell off the lattice: ${[x, y, w, h]}`);
      ok(x >= 0 && y >= 0 && x + w <= icon.w && y + h <= icon.h,
         `${name} has a cell outside its box: ${[x, y, w, h]} in ${icon.w}x${icon.h}`);
    }
  }
  console.log(`  ${Object.keys(ICONS).length} icons, every cell a whole number inside its box`);
}

function slugRule() {
  const got = assignSlugs(ADVERSARIAL.map((r) => ({ title: r.title, artist: r.artist })), 'playlist');
  for (const [i, want] of ADVERSARIAL.entries()) {
    ok(got[i].key === want.key,
       `${JSON.stringify(want.title)} slugs to ${got[i].key}, not ${want.key}`);
  }
  // No two titles may share an address, whatever they are.
  const keys = new Set(got.map((g) => g.key));
  ok(keys.size === got.length, 'two titles were given the same address');
  ok(slugify(undefined) === '' && slugify(null) === '', 'slugify does not survive nothing');
  console.log(`  ${ADVERSARIAL.length} awkward titles, all spelled as expected`);
}

/* ── the run ───────────────────────────────────────────────────────────── */

async function build() {
  console.log('building the pages the sources ask for');
  const code = await new Promise((done) => {
    spawn('npx', ['astro', 'build'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
      .on('exit', done);
  });
  if (code !== 0) {
    console.error('the build failed');
    process.exit(1);
  }
}

async function main() {
  if (process.argv.includes('--serve')) {
    await serve();
    console.log(`serving ${DIST} at ${BASE}`);
    return new Promise(() => {});
  }

  if (!process.argv.includes('--no-build')) await build();
  if (!existsSync(DIST)) {
    console.error('there is no dist/ to test. Run: npm run build');
    process.exit(1);
  }

  const tracks = parseTracks(JSON.parse(
    await readFile(join(ROOT, 'public/tracks/playlist.json'), 'utf8')));
  const show = parseEpisodes(
    await readFile(join(ROOT, 'public/stories/feed.rss'), 'utf8'));
  const eps = show.episodes;
  console.log(`${tracks.length} songs, ${eps.length} episodes`);

  console.log('the icons are drawn, not typed');
  iconRule();

  console.log('the rule an address is spelled by');
  slugRule();

  console.log('the rule a search is matched by');
  foldRule();

  console.log('the theme the page wears before the deck has run');
  fallbackRule();

  /* A filename is also an address — the deck serves it from /tracks/<file> —
     so it is held to the same shape an address is. Left to drift, one song
     with an apostrophe in its filename puts a %27 back in the URL. */
  console.log('every song is a file the URL can carry as it stands');
  for (const t of tracks) {
    if (t.file === undefined) continue; // hosted elsewhere; it carries its own url
    ok(/^[a-z0-9]+(?:-[a-z0-9]+)*\.mp3$/.test(t.file),
       `${t.file} is not a slug: lower case, hyphens, and .mp3`);
    ok(t.url === encodeURI(t.url) && !/%/.test(t.url),
       `${t.url} needs escaping to be asked for`);
  }
  console.log(`  ${tracks.length} filenames, none of them needing an escape`);

  console.log('every item has a page, and nothing else does');
  for (const kind of ['playlist', 'podcast']) {
    const want = new Set([...(kind === 'playlist' ? tracks : eps)].map((i) => `${i.slug}.html`));
    want.add('index.html'); // the directory twin of playlist.html / podcast.html
    const have = new Set(await readdir(join(DIST, kind)));
    for (const name of want) ok(have.has(name), `dist/${kind}/${name} was not written`);
    for (const name of have) ok(want.has(name), `dist/${kind}/${name} is a page for nothing`);
  }
  // The list pages are written twice on purpose; both have to be there.
  for (const path of ['playlist.html', 'playlist/index.html',
                      'podcast.html', 'podcast/index.html', '404.html', 'sitemap.xml']) {
    ok(existsSync(join(DIST, path)), `dist/${path} is missing`);
  }

  const server = await serve();
  try {
    console.log('asking for every route');
    const routes = ['/', '/playlist', '/podcast',
                    ...tracks.map((t) => `/${t.key}`), ...eps.map((e) => `/${e.key}`)];

    for (const path of routes) {
      const { status, body } = await get(path);
      if (!ok(status === 200, `${path} answered ${status}, not 200`)) continue;
      ok(canonical(body) === CANON + path, `${path}: canonical is ${canonical(body)}`);
      ok(meta(body, 'og:url', 'property') === CANON + path,
         `${path}: og:url is ${meta(body, 'og:url', 'property')}`);
      ok(!meta(body, 'robots').includes('noindex'), `${path}: not indexable`);
      ok(loadsDeck(body), `${path}: does not load the deck`);
      // The readout has to be able to host itself in a canvas, or the tape
      // has nothing to draw.
      ok(body.includes('id="lcdBody"') && body.includes('layoutsubtree'),
         `${path}: the readout cannot host the tape`);
      // The find box is prerendered like everything else, so it is there
      // before the deck is.
      ok(body.includes('id="find"') && body.includes('id="findHint"'),
         `${path}: no find box`);
      /* Every icon is drawn, not typed. A character here would be drawn by
         whatever font the browser fell back to, because none of these are in
         a subset this site ships — and ▶ and ◀ arrive as colour emoji on
         some phones. */
      const typed = [...body].filter((c) => GLYPHS.has(c));
      ok(typed.length === 0,
         `${path}: ${JSON.stringify(typed.join(''))} is a character where an icon should be`);
    }

    console.log('the pages behind a permalink carry their own item');
    for (const item of [...tracks, ...eps]) {
      const path = `/${item.key}`;
      const { body } = await get(path);
      const s = seed(body);
      if (!ok(s !== null, `${path}: no item baked in`)) continue;
      ok(s.slug === item.slug, `${path}: the item baked in is ${s.slug}`);
      ok(s.kind === item.kind, `${path}: wrong kind baked in`);
      ok(s.title === item.title, `${path}: wrong title baked in`);
      ok(title(body).includes(item.title), `${path}: the title tag is ${title(body)}`);
      if (item.kind === 'playlist') ok(s.file === item.file, `${path}: wrong file baked in`);
      else ok(s.url === item.url, `${path}: wrong audio url baked in`);
      ok(body.includes(`href="${path}"`), `${path}: the page does not link to itself`);
    }

    // Home and the two lists carry the whole list, which is how a crawler
    // reaches every song without a sitemap.
    {
      const { body } = await get('/playlist');
      for (const t of tracks) ok(body.includes(`href="/${t.key}"`), `/playlist does not link to ${t.key}`);
    }
    {
      const { body } = await get('/podcast');
      for (const e of eps) ok(body.includes(`href="/${e.key}"`), `/podcast does not link to ${e.key}`);
    }
    {
      const { body } = await get('/');
      const rows = (body.match(/class="track[ "]/g) ?? []).length;
      ok(rows === tracks.length, `/ prerenders ${rows} rows for ${tracks.length} songs`);
    }

    console.log('following every link in every page');
    const seen = new Set();
    for (const path of routes) {
      const { body } = await get(path);
      for (const href of new Set([...body.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]))) {
        if (seen.has(href)) continue;
        seen.add(href);
        const { status } = await get(href);
        ok(status === 200, `${path} links to ${href}, which answered ${status}`);
      }
    }
    console.log(`  ${seen.size} distinct internal links, all served`);

    console.log('the spellings a link gets typed in');
    for (const [path, why] of [
      ['/playlist/still-licensed/', 'a trailing slash'],
      ['/playlist/still-licensed.html', 'the file itself'],
      ['/playlist/', 'the list as a directory'],
      ['/PLAYLIST/STILL-LICENSED', 'shouted'],
      ['/playlist/nope-not-a-song', 'a song that is not there'],
      ['/nonsense/at/all', 'nonsense'],
    ]) {
      const { status, body } = await get(path);
      ok(status === 200 || status === 404, `${path} (${why}) answered ${status}`);
      ok(loadsDeck(body), `${path} (${why}) did not come back as something the deck can route`);
    }

    console.log('the sitemap');
    const { body: sm } = await get('/sitemap.xml');
    for (const path of routes) {
      ok(sm.includes(`<loc>${CANON + path}</loc>`), `the sitemap is missing ${path}`);
    }
    const locs = (sm.match(/<loc>/g) ?? []).length;
    ok(locs === routes.length, `the sitemap has ${locs} entries for ${routes.length} routes`);

    console.log('the 404 page');
    {
      const { status, body } = await get('/definitely-not-here');
      ok(status === 404, `an unknown address answered ${status}, not 404`);
      ok(meta(body, 'robots').includes('noindex'), 'the 404 page is indexable');
    }

    console.log('the shell the host needs');
    for (const path of ['/CNAME', '/robots.txt', '/site.webmanifest', '/sw.js',
                        '/tracks/playlist.json', '/stories/feed.rss']) {
      const { status } = await get(path);
      ok(status === 200, `${path} answered ${status}`);
    }
    ok(existsSync(join(DIST, '.nojekyll')), 'dist/.nojekyll is missing');
    ok((await readFile(join(DIST, 'CNAME'), 'utf8')).trim() === 'radio.omarchy.org',
       'dist/CNAME does not name the site');
  } finally {
    server.close();
  }

  console.log(`\n${checks} checks`);
  if (fails.length) {
    console.log(`${fails.length} FAILED:`);
    for (const f of fails.slice(0, 40)) console.log(`  - ${f}`);
    if (fails.length > 40) console.log(`  ... and ${fails.length - 40} more`);
    process.exit(1);
  }
  console.log('all passed');
}

await main();
