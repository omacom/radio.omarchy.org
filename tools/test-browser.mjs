/* Drives a real browser over the routes, because the thing worth testing
   about a permalink is not that the file exists — tools/test-routes.mjs has
   that — but what happens in the four seconds after somebody opens one.

       node tools/test-browser.mjs

   It serves dist/ through tools/test-routes.mjs --serve, which resolves paths
   the way GitHub Pages does, and drives chromium through the DevTools
   protocol. No dependencies: node's own WebSocket, and chromium. Run
   `npm run build` first, or `npm test`, which builds.

   Point it at what is deployed to check a deploy:

       SITE=https://radio.omarchy.org node tools/test-browser.mjs

   What it checks, in the two states a browser can be in about autoplay:

     - opening /playlist/<song> plays that song, and nothing else
     - opening /podcast/<episode> loads that episode
     - when an audible autoplay is refused, it plays muted anyway and the
       next press turns the sound on where the track has got to
     - pressing a row routes: the address follows, the page does not reload,
       and the audio swaps without going back to the network for a document
     - back and forward walk the songs that were pressed
     - the tabs are links, and /playlist and /podcast are pages
     - the links from before the paths still work, and rewrite themselves
     - a page that names nothing plays the playlist, from the top, without
       taking the address over
     - a slug that names nothing falls back to the playlist
     - the last track runs into the first one
*/

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8902;
// Point it at the deployed site to check a deploy: SITE=https://radio.omarchy.org
const SITE = process.env.SITE || '';
const BASE = SITE.replace(/\/+$/, '') || `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9333;
const ROOT = new URL('..', import.meta.url).pathname;

const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'];

let passed = 0;
let mark = 0;
let started = false;
const failures = [];

function section(name) {
  if (started) console.log(`  ${passed - mark} checks`);
  started = true;
  mark = passed;
  console.log(`\n${name}`);
}

function ok(cond, what) {
  if (cond) { passed++; return true; }
  failures.push(what);
  console.log(`  FAIL  ${what}`);
  return false;
}

function is(actual, expected, what) {
  return ok(actual === expected, `${what}: got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, ms = 6000, step = 100) {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) { ok(false, `timed out waiting for ${what}`); return null; }
    await sleep(step);
  }
}

/* ── the probe ────────────────────────────────────────────────────────
   Installed before any of the page's own scripts, because the deck plays on
   its first tick and this has to be watching by then. The audio elements are
   never in the document, so the prototype is where they can be seen. */
const PROBE = `
window.__probe = { plays: [], refused: [], media: [], copied: [], statuses: [] };
/* Every value the status line has held, not just the one it holds now. Some
   of what the deck does is only visible as a state it passed through — a
   reconnect that was scheduled and then satisfied leaves nothing behind. */
document.addEventListener('DOMContentLoaded', function () {
  var node = document.getElementById('status');
  if (!node) return;
  var seen = function () {
    var t = (node.textContent || '').trim();
    if (t && window.__probe.statuses[window.__probe.statuses.length - 1] !== t) {
      window.__probe.statuses.push(t);
    }
  };
  seen();
  new MutationObserver(seen).observe(node, { childList: true, characterData: true, subtree: true });
});
try {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: function (t) { window.__probe.copied.push(t); return Promise.resolve(); } }
  });
} catch (e) { /* left as it is */ }
(function () {
  var play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (window.__probe.media.indexOf(this) < 0) window.__probe.media.push(this);
    var el = this;
    window.__probe.plays.push(el.src || el.currentSrc || '');
    var p;
    try { p = play.apply(this, arguments); } catch (e) {
      window.__probe.refused.push(String(e && e.name || e));
      throw e;
    }
    if (p && p.catch) p.catch(function (err) {
      window.__probe.refused.push(String((err && err.name) || err));
    });
    return p;
  };
})();
window.__state = function () {
  var on = document.querySelector('.track.is-on');
  var live = window.__probe.media.filter(function (m) { return !m.paused; });
  return {
    path: location.pathname,
    hash: location.hash,
    title: document.title,
    canonical: (document.querySelector('link[rel=canonical]') || {}).href || '',
    status: (document.getElementById('status') || {}).textContent || '',
    marquee: (document.querySelector('.marq-txt') || {}).textContent || '',
    row: on ? (on.querySelector('.tr-title') || {}).textContent : '',
    rowHref: on ? on.getAttribute('href') : '',
    state: on ? (on.querySelector('.tr-st') || {}).textContent : '',
    rows: document.querySelectorAll('a.track').length,
    // The numbers on screen, which are the items' places in the list rather
    // than their places among whatever the find box left showing.
    nums: Array.prototype.map.call(document.querySelectorAll('#tracks .tr-n'),
      function (n) { return n.textContent; }),
    titles: Array.prototype.map.call(document.querySelectorAll('#tracks .tr-title'),
      function (n) { return n.textContent; }),
    query: (document.getElementById('find') || {}).value || '',
    scroll: (function () {
      var box = document.getElementById('tracks');
      var row = document.querySelector('#tracks li.is-on');
      if (!box) return null;
      var out = { top: box.scrollTop, height: box.clientHeight,
                  scrollable: box.scrollHeight > box.clientHeight + 1, inView: null };
      if (row) {
        out.rowTop = row.offsetTop;
        out.rowHeight = row.offsetHeight;
        out.inView = row.offsetTop >= box.scrollTop &&
          row.offsetTop + row.offsetHeight <= box.scrollTop + box.clientHeight;
      }
      return out;
    })(),
    hint: (document.getElementById('findHint') || {}).textContent || '',
    skin: (document.getElementById('skinName') || {}).textContent || '',
    skins: Array.prototype.map.call(document.querySelectorAll('#themeMenu li'),
      function (li) { return li.dataset.skin; }),
    tab: (document.querySelector('.seg-b.is-on') || {}).id || '',
    note: (document.getElementById('playlistNote') || {}).textContent || '',
    plays: window.__probe.plays.slice(),
    statuses: window.__probe.statuses.slice(),
    copied: window.__probe.copied.slice(),
    refused: window.__probe.refused.slice(),
    playing: live.length > 0,
    muted: live.length ? live[0].muted : null,
    src: live.length ? live[0].src : '',
    at: live.length ? live[0].currentTime : 0,
    error: window.__probe.media.map(function (m) { return m.error ? m.error.code : 0; }),
    sentinel: window.__sentinel || 0,
    entries: history.length
  };
};
`;

/* ── a very small DevTools client ─────────────────────────────────────── */
class Browser {
  static async launch(policy) {
    const bin = await which();
    const profile = await mkdtemp(join(tmpdir(), 'omarchy-radio-test-'));
    const args = [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      `--autoplay-policy=${policy}`,
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--window-size=1400,1000',
      '--hide-scrollbars',
      'about:blank',
    ];
    const proc = spawn(bin, args, { stdio: 'ignore' });
    let ws = '';
    for (let i = 0; i < 100 && !ws; i++) {
      await sleep(100);
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
        ws = (await r.json()).webSocketDebuggerUrl;
      } catch { /* not up yet */ }
    }
    if (!ws) { proc.kill('SIGKILL'); throw new Error('chromium never opened a debugging port'); }
    return new Browser(proc, profile, await open(ws));
  }

  constructor(proc, profile, sock) {
    this.proc = proc;
    this.profile = profile;
    this.sock = sock;
    this.id = 0;
    this.waiting = new Map();
    this.events = [];
    sock.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.sock.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.waiting.delete(id)) reject(new Error(`${method} never answered`));
      }, 20000);
    });
  }

  async tab() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const tab = new Tab(this, sessionId, targetId);
    await tab.send('Page.enable');
    await tab.send('Runtime.enable');
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE });
    return tab;
  }

  async close() {
    try { this.sock.close(); } catch { /* already gone */ }
    this.proc.kill('SIGTERM');
    await sleep(300);
    this.proc.kill('SIGKILL');
    await rm(this.profile, { recursive: true, force: true });
  }
}

class Tab {
  constructor(browser, sessionId, targetId) {
    this.browser = browser;
    this.sessionId = sessionId;
    this.targetId = targetId;
  }

  send(method, params) { return this.browser.send(method, params, this.sessionId); }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(`page threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result.value;
  }

  async go(path) {
    await this.send('Page.navigate', { url: BASE + path });
    // The deck boots on DOMContentLoaded; the fonts and the audio can take
    // their time, so this waits for the deck rather than for the load event.
    await until(`${path} to boot`, () => this.eval('!!(window.__state && document.getElementById("status"))'));
    await this.eval('window.__sentinel = 1');
  }

  state() { return this.eval('window.__state()'); }

  async click(selector) {
    const box = await this.eval(`(function () {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      var r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (!box) { ok(false, `nothing to click at ${selector}`); return false; }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', {
        type, x: Math.round(box.x), y: Math.round(box.y),
        button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0,
      });
    }
    return true;
  }

  close() { return this.browser.send('Target.closeTarget', { targetId: this.targetId }); }
}

async function which() {
  for (const name of BROWSERS) {
    const found = await new Promise((resolve) => {
      const p = spawn('sh', ['-c', `command -v ${name}`], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('close', () => resolve(out.trim()));
    });
    if (found) return found;
  }
  throw new Error(`no chromium found (tried ${BROWSERS.join(', ')})`);
}

function open(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    sock.addEventListener('open', () => resolve(sock), { once: true });
    sock.addEventListener('error', reject, { once: true });
  });
}

/* ── the site under test ─────────────────────────────────────────────── */
function serve() {
  if (SITE) return { kill() {} }; // testing what is deployed, not what is here
  return spawn('node', [join(ROOT, 'tools/test-routes.mjs'), '--serve'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
}

async function routes() {
  const sitemap = await (await fetch(`${BASE}/sitemap.xml`)).text();
  const paths = [...sitemap.matchAll(/<loc>[^<]*?(\/(?:playlist|podcast)\/[^<]+)<\/loc>/g)]
    .map((m) => m[1]);
  const items = [];
  for (const path of paths) {
    const body = await (await fetch(BASE + path)).text();
    const m = body.match(/window\.__ITEM__ = (\{[\s\S]*?\});/);
    if (!m) throw new Error(`${path} has no item baked into it`);
    items.push({ path, ...JSON.parse(m[1].replace(/\\u003c/g, '<')) });
  }
  return {
    songs: items.filter((i) => i.kind === 'playlist'),
    eps: items.filter((i) => i.kind === 'podcast'),
  };
}

/* ── the checks ──────────────────────────────────────────────────────── */

/* Typing into the find box, which is the one thing the deck does to what is
   on screen that deliberately does not touch the address. */
async function find({ songs }) {
  section('finding a song');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/playlist');
    /* Every page arrives with the rows already in it, so a row on screen is
       not evidence the deck is running — and typing into a box whose listener
       is not attached yet does nothing at all. Playing is the signal that the
       deck has booted, read the manifest and taken the list over. */
    const all = await until('the deck to own the playlist', async () => {
      const s = await tab.state();
      return s.playing && s.rows >= songs.length ? s : null;
    });
    if (!all) return;

    const type = async (q) => {
      await tab.eval(`(function () {
        var b = document.getElementById('find');
        b.value = ${JSON.stringify(q)};
        b.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      return tab.state();
    };

    // A word from a title and a word from an artist, which no single field has.
    let s = await type('koontz fix');
    is(s.rows, 1, 'both words have to appear, across the title and the artist');
    ok(/Fix Everything/.test(s.titles[0] || ''), `and it is the right song (${s.titles[0]})`);
    // The number is the song's place in the playlist, not its place here.
    const at = all.titles.indexOf(s.titles[0]);
    is(s.nums[0], String(at + 1).padStart(2, '0'),
       'a filtered row keeps the number it has in the playlist');
    ok(/\b1 of \d+ tracks\b/.test(s.note), `the note counts the matches (${s.note})`);
    is(s.hint, 'esc', 'and the key hint says how to get out of it');

    // An accent nobody is going to type.
    s = await type('aurelien');
    is(s.rows, 1, 'accents are folded on both sides');

    s = await type('zzz-nothing-is-called-this');
    is(s.rows, 0, 'a query that matches nothing shows nothing');
    ok(/nothing matched/.test(s.note), `and says so (${s.note})`);

    // Nothing about any of it is an address.
    is(s.path, '/playlist', 'a query does not touch the address');

    s = await type('');
    is(s.rows, songs.length, 'emptying it brings the playlist back');
    is(s.hint, '/', 'and the hint goes back to the key that focuses it');

    // The query was typed at the songs; the episodes are a different list.
    await type('quattro');
    await tab.eval("document.getElementById('tabPodcast').click()");
    s = await until('the podcast tab', async () => {
      const st = await tab.state();
      return st.tab === 'tabPodcast' ? st : null;
    });
    if (s) is(s.query, '', 'switching lists clears the query rather than filtering the other one');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* A visitor coming back after the files were renamed.
   Slugs come from titles, so a song whose file changed is the same song at the
   same address — but the copy of the playlist kept in localStorage names the
   old file, and the deck starts playing it before the real manifest lands.
   The manifest is the authority on where a song lives. */
async function stalePlaylist({ songs }) {
  section('coming back to a playlist whose files have moved');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  /* A permalink, not the front page. tuneIn() only reaches for the kept copy
     when the address names something out of a list — the front page has
     nothing to look up, so it waits for the manifest and the stale copy never
     gets a chance to be wrong. */
  const song = songs[3];
  try {
    // Arrive once so the deck keeps a copy, then spoil the copy the way a
    // rename would have: same titles, files that are no longer there.
    await tab.go('/');
    await until('the deck to keep a copy', () =>
      tab.eval("!!localStorage.getItem('omarchy-radio-playlist')"));

    const spoiled = await tab.eval(`(function () {
      var kept = JSON.parse(localStorage.getItem('omarchy-radio-playlist'));
      kept.tracks.forEach(function (t) { t.file = 'gone-' + t.file; });
      localStorage.setItem('omarchy-radio-playlist', JSON.stringify(kept));
      return kept.tracks[0].file;
    })()`);
    ok(/^gone-/.test(spoiled), `the kept copy now names files that are not there (${spoiled})`);

    await tab.go(song.path);
    const s = await until('the deck to play the file the manifest names', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    }, 20000);
    if (!s) return;
    ok(!/gone-/.test(decodeURIComponent(s.src)),
       `it is not playing the file that moved (${decodeURIComponent(s.src).split('/').pop()})`);
    ok(decodeURIComponent(s.src).includes(song.file),
       'it is playing the one the manifest names');
    is(s.rows, songs.length, 'and the list is the real one');

    /* And it got there directly. The reconnect budget would have corrected
       this on its own a second later — the address it retries is read back
       from the list — so the end state is not what distinguishes a deck that
       takes the manifest's word from one that waits to be told by a 404.
       What distinguishes them is whether anybody had to watch it reconnect. */
    const stalled = s.statuses.filter((t) => /reconnect|would not play/i.test(t));
    ok(stalled.length === 0,
       `it did not have to reconnect to find out (saw: ${stalled.join(' / ') || 'nothing'})`);
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* Following a link to a song a long way down the list.
   A permalink arrives with one row in the page and the whole playlist a
   moment later, so the row it named ends up wherever it sits — which for the
   last song is well below the fold of a list that scrolls. */
async function reveal({ songs }) {
  section('being sent to a song down the list');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    const last = songs[songs.length - 1];
    await tab.go(last.path);
    const s = await until('the song, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.rows >= songs.length ? st : null;
    });
    if (!s) return;

    is(s.rowHref, last.path, 'the row the address named is the one playing');
    if (!ok(s.scroll && s.scroll.scrollable, 'the list is long enough to scroll')) return;
    ok(s.scroll.inView, `and the row is in view (list at ${s.scroll.top}, row at ${s.scroll.rowTop})`);
    ok(s.scroll.top > 0, 'which it could not be at the top of the list');

    // The first song is above the fold already, so nothing should move.
    const first = songs[0];
    await tab.go(first.path);
    const f = await until('the first song', async () => {
      const st = await tab.state();
      return st.playing && st.rowHref === first.path ? st : null;
    });
    if (f) {
      is(f.scroll.top, 0, 'a row already in view does not move the list');
      ok(f.scroll.inView, 'and is in view');
    }

    /* Pressing a row is a press on something already on screen, and a track
       ending into the next one must not move the list out from under whoever
       is reading further down it. */
    await tab.eval("document.getElementById('tracks').scrollTop = 0");
    await tab.eval("document.getElementById('next').click()");
    const stepped = await until('the transport to step on', async () => {
      const st = await tab.state();
      return st.rowHref && st.rowHref !== first.path ? st : null;
    });
    if (stepped) is(stepped.scroll.top, 0, 'stepping with the transport leaves the list alone');
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The desktop's own theme, as omarchy-theme-sync publishes it: the palette
   goes onto <html> as --omarchy-* properties, which is the extension's whole
   contract with a page. This writes them the way it would. */
const ETHEREAL = { background: '#060b1e', bright_foreground: '#ffcead', accent: '#7d82d9', selection: '#252e56' };
const GRUVBOX = { background: '#282828', bright_foreground: '#d4be98', accent: '#7daea3', selection: '#504945' };

async function desktopTheme() {
  section('wearing the desktop theme');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/');
    // The menu is the deck's, so waiting for it is waiting for the deck. Rows
    // are in the page before that and say nothing about whether it has run.
    let s = await until('the deck to build the theme menu', async () => {
      const st = await tab.state();
      return st.skins.length ? st : null;
    });
    if (!s) return;

    // Without the extension there is no such theme, and the list is the list.
    is(s.skins.length, 24, 'no extension, no desktop theme');
    is(s.skins[0], 'green', 'and the list is the list');

    const publish = async (palette, name) => {
      await tab.eval(`(function () {
        var r = document.documentElement;
        ${Object.entries(palette).map(([k, v]) =>
          `r.style.setProperty('--omarchy-${k.replace(/_/g, '-')}', '${v}');`).join('\n        ')}
        r.dataset.omarchyTheme = ${JSON.stringify(name)};
        document.dispatchEvent(new Event('omarchythemechange'));
      })()`);
      return tab.eval(`(function () {
        var r = getComputedStyle(document.documentElement);
        return { bg: r.getPropertyValue('--bg').trim(), fg: r.getPropertyValue('--fg').trim(),
                 ac: r.getPropertyValue('--ac').trim(), bd: r.getPropertyValue('--bd').trim(),
                 skin: (document.getElementById('skinName') || {}).textContent,
                 first: (document.querySelector('#themeMenu li') || {}).dataset.skin,
                 count: document.querySelectorAll('#themeMenu li').length,
                 meta: (document.querySelector('meta[name=theme-color]') || {}).content };
      })()`);
    };

    let d = await publish(ETHEREAL, 'ethereal');
    is(d.count, 25, 'the palette lands and the deck gains a theme');
    is(d.first, 'desktop', 'first in the list, because it is the one you are wearing');
    is(d.skin, 'desktop · ethereal', 'and the picker names the theme the desktop is on');
    is(d.bg, ETHEREAL.background, 'the ground is the desktop background');
    is(d.fg, ETHEREAL.bright_foreground, 'the ink is its bright foreground');
    is(d.ac, ETHEREAL.accent, 'the accent is its accent');
    is(d.bd, ETHEREAL.selection, 'the line is its selection');
    is(d.meta, ETHEREAL.background, 'and the browser chrome follows the ground');

    // Switching the desktop theme repaints without a reload, which is the point.
    d = await publish(GRUVBOX, 'gruvbox');
    is(d.skin, 'desktop · gruvbox', 'a desktop theme change is followed');
    is(d.bg, GRUVBOX.background, 'and repaints without a reload');
    is(d.ac, GRUVBOX.accent, 'accent too');

    // Picking one of the twenty-four pins it against the desktop.
    await tab.eval(`Array.prototype.find.call(
      document.querySelectorAll('#themeMenu li'),
      function (li) { return li.dataset.skin === 'nord'; }).querySelector('button').click()`);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'nord', 'a theme picked by hand is not overruled by the desktop');
    ok(d.bg !== ETHEREAL.background, 'and keeps its own ground');

    // ...and survives a reload, still against a palette that is right there.
    await tab.go('/');
    await until('the deck again', async () => (await tab.state()).rows || null);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'nord', 'and is still pinned on the next visit');

    /* The deck writes the theme it painted on every paint, so a returning
       listener always has one stored whether they ever picked it or not.
       That is not a choice, and the desktop's own theme outranks it. */
    await tab.eval(`(function () {
      localStorage.removeItem('omarchy-radio-skin-pinned');
      localStorage.setItem('omarchy-radio-skin', 'nord');
    })()`);
    await tab.go('/');
    await until('the deck once more', async () => (await tab.state()).skins.length || null);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'desktop · ethereal',
       'a theme the deck merely stored is not a choice, and the desktop wins');
    is(d.bg, ETHEREAL.background, 'and the ground is the desktop ground');

    // Picking "desktop" is how you go back to following the machine.
    await tab.eval(`(function () {
      localStorage.setItem('omarchy-radio-skin-pinned', 'nord');
    })()`);
    await tab.go('/');
    await until('the deck a last time', async () => (await tab.state()).skins.length || null);
    d = await publish(ETHEREAL, 'ethereal');
    is(d.skin, 'nord', 'pinned again');
    await tab.eval(`Array.prototype.find.call(
      document.querySelectorAll('#themeMenu li'),
      function (li) { return li.dataset.skin === 'desktop'; }).querySelector('button').click()`);
    d = await publish(GRUVBOX, 'gruvbox');
    is(d.skin, 'desktop · gruvbox', 'and picking desktop follows the machine again');
  } finally {
    await tab.close();
    await browser.close();
  }
}

async function autoplayAllowed({ songs, eps }) {
  section('with autoplay allowed, the way a browser treats a site somebody uses');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    // ── a song's own page plays that song, and only that song ──
    const wanted = songs[1];
    const song = wanted.path;
    await tab.go(song);
    /* Playing *and* holding the whole playlist. Two things that arrive on
       their own schedules — the seeded row plays on the first tick, the
       manifest lands a moment later — and this section asserts about both,
       so it has to wait for both. Against a local server the second is
       instant and the race is never lost; over the wire the list turns up
       around 140ms in and the poll is every 100, which is close enough to
       lose it about half the time. That is the fourth time this file has
       waited for one thing and asserted about another. */
    let s = await until('the song to start, out of the whole playlist', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 && st.rows >= songs.length ? st : null;
    });
    if (s) {
      is(s.path, song, 'the address stays put');
      is(s.plays.length, 1, 'one play call, for the one song asked for');
      ok(s.src.endsWith('.mp3'), `the source is a track: ${s.src}`);
      ok(decodeURIComponent(s.src).includes(wanted.file), `it is the right file: ${decodeURIComponent(s.src)}`);
      ok(s.at > 0, `the audio is actually moving (${s.at.toFixed(2)}s in)`);
      is(s.refused.length, 0, 'nothing was refused');
      is(s.row, wanted.title, 'the row for it is the one lit');
      is(s.state, 'playing', 'the row says playing');
      ok(s.title.includes(wanted.title), `the tab is named after it: ${s.title}`);
      ok(s.marquee.includes(wanted.title), `the deck reads it out: ${s.marquee}`);
      is(s.canonical, `https://radio.omarchy.org${song}`, 'the canonical link');
      is(s.tab, 'tabSongs', 'the songs tab is the current one');
      ok(s.rows >= songs.length, `the whole playlist arrived (${s.rows} rows)`);
    }

    // ── pressing a row routes without reloading ──
    const other = songs[5];
    const otherPath = other.path;
    await tab.click(`a.track[href="${otherPath}"]`);
    s = await until('the second song', async () => {
      const st = await tab.state();
      return st.path === otherPath && st.playing ? st : null;
    });
    if (s) {
      is(s.path, otherPath, 'the address follows the press');
      is(s.sentinel, 1, 'the page did not reload');
      is(s.plays.length, 2, 'the second song is the second play call');
      ok(decodeURIComponent(s.src).includes(other.file), 'the audio swapped to it');
      is(s.row, other.title, 'and the lit row moved with it');
    }

    // ── back walks the two of them ──
    await tab.eval('history.back()');
    s = await until('the first song again', async () => {
      const st = await tab.state();
      return st.path === song ? st : null;
    });
    if (s) {
      is(s.path, song, 'back returns to the song it came from');
      is(s.sentinel, 1, 'back did not reload the page either');
      is(s.row, wanted.title, 'and it is the one playing');
    }
    await tab.eval('history.forward()');
    s = await until('the second song again', async () => {
      const st = await tab.state();
      return st.path === otherPath ? st : null;
    });
    if (s) is(s.row, other.title, 'forward goes back to the other one');

    // ── the tabs are links to the two lists ──
    await tab.click('#tabPodcast');
    s = await until('the podcast list', async () => {
      const st = await tab.state();
      return st.path === '/podcast' ? st : null;
    });
    if (s) {
      is(s.path, '/podcast', 'the podcast tab is a link to /podcast');
      is(s.tab, 'tabPodcast', 'and it is the current one');
      is(s.sentinel, 1, 'without a reload');
      ok(s.note.includes('episode'), `the note counts episodes: ${s.note.trim()}`);
    }
    await tab.click('#tabSongs');
    s = await until('the songs list', async () => {
      const st = await tab.state();
      return st.tab === 'tabSongs' ? st : null;
    });
    if (s) {
      is(s.tab, 'tabSongs', 'and back to the songs');
      // The song never stopped, and with its list on screen again the
      // address is its own page rather than the list it sits in.
      is(s.path, otherPath, 'the address names the song still playing');
      is(s.sentinel, 1, 'still no reload');
    }

    // ── the front page plays the playlist without taking the address ──
    await tab.go('/');
    s = await until('the playlist to start by itself', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, '/', 'the front page stays the front page');
      is(s.canonical, 'https://radio.omarchy.org/', 'and goes on saying so');
      ok(decodeURIComponent(s.src).includes(songs[0].file),
         'the playlist starts itself, from the top');
      is(s.row, songs[0].title, 'and the row it is on is lit');
      is(s.title, 'Omarchy Radio', 'the tab stays the front page, not a song nobody picked');
      ok(!/live|stream/i.test(s.status), `nothing about a stream: "${s.status.trim()}"`);
    }

    // ── the end of the last one is the start of the first ──
    const last = songs[songs.length - 1];
    await tab.go(last.path);
    await until('the last song', async () => (await tab.state()).playing);

    // Pressing next on the last one is the wrap on its own terms.
    await tab.click('#next');
    s = await until('the first song, from the transport', async () => {
      const st = await tab.state();
      return st.row === songs[0].title ? st : null;
    });
    if (s) is(s.row, songs[0].title, 'next on the last track wraps to the first');

    // And so is running off the end of it, which is what a rotation is.
    // The server answers byte ranges, so the needle can just be dropped.
    await tab.go(last.path);
    await until('the last song again', async () => (await tab.state()).playing);
    const seeked = await until('the last song to be seekable', () => tab.eval(`(function () {
      var live = window.__probe.media.filter(function (m) { return !m.paused; })[0];
      if (!live || !isFinite(live.duration) || !live.duration) return false;
      live.currentTime = live.duration - 0.3;
      return true;
    })()`), 15000, 200);
    if (ok(seeked, 'the last track can be run to its end')) {
      s = await until('the first song to come round', async () => {
        const st = await tab.state();
        return st.row === songs[0].title ? st : null;
      }, 15000);
      if (s) {
        is(s.row, songs[0].title, 'the end of the last track is the start of the first');
        ok(decodeURIComponent(s.src).includes(songs[0].file), 'and it is that file playing');
        is(s.path, songs[0].path, 'the address follows, this one having been named');
      }
    }

    // ── an episode's own page loads that episode ──
    if (eps.length) {
      await tab.go(eps[0].path);
      s = await until('the episode to be asked for', async () => {
        const st = await tab.state();
        return st.plays.length ? st : null;
      });
      if (s) {
        is(s.path, eps[0].path, 'the address stays put');
        const asked = s.plays[s.plays.length - 1];
        ok(/^https?:/.test(asked) && !/\/tracks\//.test(asked),
           `the audio asked for is the show's host, not a track: ${asked.slice(0, 60)}…`);
        is(s.tab, 'tabPodcast', 'the podcast tab is the current one');
        ok(s.row.length > 0, `the episode row is lit: ${s.row}`);
      }
    }

    // ── the links from before the paths ──
    await tab.go('/#still-licensed');
    s = await until('the old link to resolve', async () => {
      const st = await tab.state();
      return st.path === '/playlist/still-licensed' ? st : null;
    });
    if (s) {
      is(s.path, '/playlist/still-licensed', 'a bare fragment is now a path');
      is(s.hash, '', 'and the fragment is gone');
      is(s.row, 'Still Licensed', 'playing the song it named');
    }

    if (eps.length) {
      const epSlug = eps[0].slug;
      await tab.go('/#stories/' + epSlug);
      s = await until('the old episode link to resolve', async () => {
        const st = await tab.state();
        return st.path === '/podcast/' + epSlug ? st : null;
      });
      if (s) is(s.path, '/podcast/' + epSlug, '#stories/<episode> is now /podcast/<episode>');
    }

    // ── the spellings a link gets typed in, and what a reload does ──
    await tab.go(song + '/');
    s = await until('the trailing slash to be tidied', async () => {
      const st = await tab.state();
      return st.path === song ? st : null;
    });
    if (s) {
      is(s.path, song, 'a trailing slash resolves to the address without one');
      ok(s.playing || s.plays.length > 0, 'and the song still plays');
    }

    await tab.go(song);
    await until('the song before the reload', async () => (await tab.state()).playing);
    await tab.send('Page.reload');
    s = await until('the song after the reload', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, song, 'a reload of a permalink stays on it');
      is(s.plays.length, 1, 'and starts the one song, once');
      is(s.sentinel, 0, 'the reload really was one');
    }

    // ── a slug that names nothing ──
    await tab.go('/playlist/no-such-song-at-all');
    s = await until('the fallback to the playlist', async () => {
      const st = await tab.state();
      return st.path === '/' && st.playing ? st : null;
    });
    if (s) {
      is(s.path, '/', 'a slug that names nothing lands on the front');
      ok(decodeURIComponent(s.src).includes(songs[0].file),
         'and the playlist starts from the top');
    }

    // ── the transport does not build a history to climb out of ──
    await tab.go(song);
    await until('the song again', async () => (await tab.state()).playing);
    const before = (await tab.state()).entries;
    await tab.click('#next');
    s = await until('the next song', async () => {
      const st = await tab.state();
      return st.path !== song ? st : null;
    });
    if (s) {
      ok(s.path.startsWith('/playlist/'), `next moves the address too: ${s.path}`);
      is(s.entries, before, 'without adding a history entry');
    }

    // ── the # beside a row is the link, and pressing it copies ──
    const at = (await tab.state()).path;
    await tab.click(`a.tr-link[href="${song}"]`);
    s = await until('the copy', async () => {
      const st = await tab.state();
      return st.copied.length ? st : null;
    });
    if (s) {
      is(s.copied[0], BASE + song, 'the # puts the whole address on the clipboard');
      is(s.path, at, 'and pressing it does not navigate anywhere');
      ok(/copied/.test(s.status), `the deck says so: "${s.status.trim()}"`);
    }

    // ── /playlist and /podcast are pages of their own ──
    for (const [path, tabId] of [['/playlist', 'tabSongs'], ['/podcast', 'tabPodcast']]) {
      await tab.go(path);
      s = await until(`${path} to settle`, async () => {
        const st = await tab.state();
        return st.plays.length ? st : null;
      });
      if (s) {
        is(s.path, path, `${path} stays as it was opened`);
        is(s.tab, tabId, `${path} opens on the right list`);
        ok(decodeURIComponent(s.plays[0]).includes(songs[0].file),
           `${path} plays the playlist from the top while you read it`);
        is(s.canonical, 'https://radio.omarchy.org' + path, `${path} says what it is`);
      }
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

async function autoplayRefused({ songs }) {
  section('with autoplay refused, the way a browser treats a first visit');
  const browser = await Browser.launch('user-gesture-required');
  const tab = await browser.tab();
  try {
    const wanted = songs[1];
    await tab.go(wanted.path);

    /* No browser grants an audible autoplay here, and every one of them
       allows a muted one. So the deck plays: no press, no asking. */
    let s = await until('the deck to play without being pressed', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (!s) return;

    is(s.muted, true, 'it is playing, and it is muted, having been refused the sound');
    ok(s.refused.includes('NotAllowedError'), 'the refusal is the one it acted on');
    ok(/muted/.test(s.status), `and the status says which kind of playing ("${s.status.trim()}")`);
    console.log(`  it says: ${JSON.stringify(s.status.trim())}`);
    ok(decodeURIComponent(s.src).includes(wanted.file), 'it is the song the link named');
    is(s.path, wanted.path, 'the address still names it');
    is(s.row, wanted.title, 'and its row is the one lit');

    // A press anywhere that is not itself a control: this is what buys sound.
    const wasAt = s.at;
    await tab.click('.lcd');
    s = await until('the sound to come on', async () => {
      const st = await tab.state();
      return st.playing && st.muted === false ? st : null;
    });
    if (s) {
      is(s.muted, false, 'a press anywhere turns the sound on');
      is(s.status.trim(), 'playing', 'and the status stops qualifying it');
      ok(s.at >= wasAt, `it carries on from where it was, not from the top (${wasAt} -> ${s.at})`);
      ok(decodeURIComponent(s.src).includes(wanted.file), 'still the same song');
      is(s.path, wanted.path, 'and the address is unchanged');
    }
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* The service worker stands in front of every navigation, so a broken one
   is a broken site. It is installed here the way a second visit installs it,
   and then the network is taken away: a page never opened before has to come
   back as the shell, and the shell has to route to the same place. */
async function offline({ songs }) {
  section('with the service worker in front, and then with no network at all');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    await tab.go('/');
    const ready = await until('the service worker to take over', async () => {
      await tab.eval('navigator.serviceWorker.ready.then(function () {})');
      return tab.eval('!!navigator.serviceWorker.controller || (location.reload(), false)');
    }, 15000, 500);
    if (!ok(ready, 'the service worker is registered and controlling the page')) return;

    // A song page, through the worker.
    const first = songs[2];
    await tab.go(first.path);
    let s = await until('the song, served through the worker', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, first.path, 'the worker does not get in the way of a permalink');
      ok(decodeURIComponent(s.src).includes(first.file), 'and the right song plays');
    }

    // Now take the network away and ask for a page never opened.
    await tab.send('Network.enable');
    await tab.send('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    });
    const unseen = songs[songs.length - 1];
    await tab.send('Page.navigate', { url: BASE + unseen.path });
    s = await until('the deck to open offline', async () => {
      const st = await tab.eval('window.__state ? window.__state() : null');
      return st && st.rows ? st : null;
    }, 15000);
    if (s) {
      is(s.path, unseen.path, 'the address survives being answered by the shell');
      is(s.row, unseen.title, 'and the deck routes to the song that was asked for');
      /* A row on screen is not yet evidence that the deck read a list: every
         page arrives with rows already in it — the shell with all of them, a
         permalink with the one it is for — and which of the two the worker
         answers with depends on what it had cached. The list is what is under
         test here, and it comes out of the cache a moment after the paint, so
         this waits for it rather than reading the prerendered row and calling
         it a miss. */
      const full = await until('the playlist to arrive from the cache', async () => {
        const st = await tab.eval('window.__state ? window.__state() : null');
        return st && st.rows > 1 ? st : null;
      }, 10000);
      if (full) ok(full.rows > 1, `the playlist came out of the cache (${full.rows} rows)`);
    }
    await tab.send('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    });
  } finally {
    await tab.close();
    await browser.close();
  }
}

/* ── go ──────────────────────────────────────────────────────────────── */
const server = serve();
let code = 1;
try {
  await until('the server', async () => {
    try { return (await fetch(BASE + '/')).ok; } catch { return false; }
  }, 15000);
  const site = await routes();
  console.log(`${site.songs.length} songs, ${site.eps.length} episodes`);
  await autoplayAllowed(site);
  await autoplayRefused(site);
  await find(site);
  await reveal(site);
  await stalePlaylist(site);
  await desktopTheme();
  await offline(site);
  console.log(`  ${passed - mark} checks`);
  console.log(`\n${passed} checks passed`);
  if (failures.length) {
    console.log(`${failures.length} FAILED:`);
    for (const f of failures) console.log(`  - ${f}`);
  } else {
    code = 0;
    console.log('all passed');
  }
} catch (e) {
  console.log(`\nthe run itself broke: ${e.stack || e.message}`);
} finally {
  server.kill('SIGKILL');
}
process.exit(code);
