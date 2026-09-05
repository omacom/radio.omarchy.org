/* Drives a real browser over the routes, because the thing worth testing
   about a permalink is not that the file exists — tools/test-routes.py has
   that — but what happens in the four seconds after somebody opens one.

       node tools/test-browser.mjs

   It serves the working tree through tools/test-routes.py --serve, which
   resolves paths the way GitHub Pages does, and drives chromium through the
   DevTools protocol. No dependencies: node's own WebSocket, and chromium.

   What it checks, in the two states a browser can be in about autoplay:

     - opening /playlist/<song> plays that song, and nothing else
     - opening /podcast/<episode> loads that episode
     - when autoplay is refused, the deck says so and the next press pays it
     - pressing a row routes: the address follows, the page does not reload,
       and the audio swaps without going back to the network for a document
     - back and forward walk the songs that were pressed
     - the tabs are links, and /playlist and /podcast are pages
     - the links from before the paths still work, and rewrite themselves
     - a slug that names nothing falls back to the live stream
*/

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8902;
const BASE = `http://127.0.0.1:${PORT}`;
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
window.__probe = { plays: [], refused: [], media: [], copied: [] };
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
    tab: (document.querySelector('.seg-b.is-on') || {}).id || '',
    note: (document.getElementById('playlistNote') || {}).textContent || '',
    plays: window.__probe.plays.slice(),
    copied: window.__probe.copied.slice(),
    refused: window.__probe.refused.slice(),
    playing: live.length > 0,
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
    // The deck boots on DOMContentLoaded; the fonts and the stream can take
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
  const proc = spawn('python3', [join(ROOT, 'tools/test-routes.py'), '--serve'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  return proc;
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

async function autoplayAllowed({ songs, eps }) {
  section('with autoplay allowed, the way a browser treats a site somebody uses');
  const browser = await Browser.launch('no-user-gesture-required');
  const tab = await browser.tab();
  try {
    // ── a song's own page plays that song, and only that song ──
    const wanted = songs[1];
    const song = wanted.path;
    await tab.go(song);
    let s = await until('the song to start', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      is(s.path, song, 'the address stays put');
      is(s.plays.length, 1, 'one play call, for the one song asked for');
      ok(s.src.endsWith('.mp3'), `the source is a track, not the stream: ${s.src}`);
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

    // ── an episode's own page loads that episode ──
    if (eps.length) {
      await tab.go(eps[0].path);
      s = await until('the episode to be asked for', async () => {
        const st = await tab.state();
        return st.plays.length ? st : null;
      });
      if (s) {
        is(s.path, eps[0].path, 'the address stays put');
        ok(/^https?:/.test(s.plays[0]) && !s.plays[0].includes('/stream'),
           `the audio asked for is the show's, not the stream: ${s.plays[0].slice(0, 60)}…`);
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
    s = await until('the fallback to the stream', async () => {
      const st = await tab.state();
      return st.path === '/' && st.plays.length ? st : null;
    });
    if (s) {
      is(s.path, '/', 'a slug that names nothing lands on the station');
      ok(s.plays[s.plays.length - 1].includes('/stream'), 'and the live stream is what plays');
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
        ok(s.plays[0].includes('/stream'), `${path} plays the live stream while you read it`);
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

    let s = await until('the deck to ask for a press', async () => {
      const st = await tab.state();
      return /to start/.test(st.status) ? st : null;
    });
    if (s) {
      ok(/click anywhere to start|tap anywhere to start/.test(s.status),
         `it says what to do: "${s.status.trim()}"`);
      ok(s.refused.includes('NotAllowedError'), 'the refusal is the one it acted on');
      is(s.playing, false, 'and nothing is playing yet');
      is(s.path, wanted.path, 'the address still names the song that was asked for');
      is(s.row, wanted.title, 'and its row is the one lit');
    }

    // A press anywhere: the deck owes this listener a song.
    await tab.click('.wordmark');
    s = await until('the owed song to play', async () => {
      const st = await tab.state();
      return st.playing && st.at > 0 ? st : null;
    });
    if (s) {
      ok(decodeURIComponent(s.src).includes(wanted.file),
         'the press pays back the song the link named, not the stream');
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
      ok(s.rows > 1, `the playlist came out of the cache (${s.rows} rows)`);
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
