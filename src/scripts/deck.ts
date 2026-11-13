/* Omarchy Radio — the deck.
 *
 * Theme application, Web Audio analysis, routing, and the two lists. The
 * field it sits on is src/scripts/field.ts and the tape on the readout is
 * src/scripts/lcd-vhs.ts; the rules an address is spelled by are in
 * src/lib/slug.ts, which the build reads too.
 *
 * There is no live stream. The playlist is the station: it starts itself on
 * arrival, plays in order, and goes round again at the end. Everything the
 * deck plays is a file in this repo, which is why every one of them has an
 * address of its own.
 */

import {
  CANON, LYRICS_DIR, SHOW, SHOW_LYRICS, SHOW_PODCAST, STATION,
  STORIES_FEED, STORIES_TAG, SHOW_HOME as STORIES_HOME,
  TRACKS_DIR, TRACKS_MANIFEST,
} from '../lib/site.ts';
import { assignSlugs, fold } from '../lib/slug.ts';
import { iconSvg } from '../lib/icons.ts';
import { dateLabel, fmt, hms, lengthLabel, plural } from '../lib/format.ts';
import { SKINS, derive, type Skin, type Theme } from './theme.ts';
import { DESKTOP, desktopName, watchDesktop } from './omarchy-theme.ts';
import type { Item, Stamped } from '../lib/item.ts';
import type { Kind } from '../lib/slug.ts';
import {
  drawField, fieldPainted, initField, markFieldStale, sizeField,
} from './field.ts';
import { initLcdTape, tearTape } from './lcd-vhs.ts';

var ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
var BAR_COUNT = 56;
/* How many bricks a band can light. Has to agree with --segs on .vis, which
   is what gives the meter its height; the pitch itself is the stylesheet's. */
var METER_SEGS = 12;
var CANVAS_W = 1180;
var CANVAS_H = 880;
var STORE_KEY = 'omarchy-radio-skin';
/* Which theme the listener *chose*, as against which one the deck last
   happened to apply — STORE_KEY is written on every paint, so it says nothing
   about whether anybody picked it. The difference is what decides whether the
   desktop's own theme may take over: it is the default when it is on offer,
   and a default is what you get until you say otherwise. */
var STORE_PIN = 'omarchy-radio-skin-pinned';
var STORE_TRACKS = 'omarchy-radio-playlist';
var STORE_STORIES = 'omarchy-radio-stories';

var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ── the elements ────────────────────────────────────────
   Every element the deck holds on to, named by the id it carries in the page.
   The list is the contract between the deck and src/components/*.astro: an id
   that is not in a component is a null here, so boot() says which one rather
   than failing later at whichever paint reached for it first. */

var IDS = [
  'bg', 'fit', 'app', 'lcd', 'lcdSrc', 'lcdBody', 'lcdOut',
  'themeBtn', 'themeMenu',
  'themeCaret', 'skinName', 'stationLabel', 'srcLabel',
  'marq', 'artist', 'curTime', 'durTime', 'vis', 'prev', 'toggle', 'stop', 'next', 'shuffle',
  'seek', 'seekFill', 'seekHead', 'volKnob', 'volRot', 'volLabel',
  'playlistKind', 'playlistName', 'tracks', 'trHead', 'playlistNote',
  'status', 'seg', 'tabSongs', 'tabPodcast',
  'lyricsBtn', 'lyricsBox', 'lyrics', 'installBtn',
  'findRow', 'find', 'findHint'
] as const;

type ElementId = (typeof IDS)[number];

/* The three canvases are the only ones the deck wants more than an
   HTMLElement's worth of. */
type Els = Record<ElementId, HTMLElement> & {
  bg: HTMLCanvasElement;
  lcdSrc: HTMLCanvasElement;
  lcdOut: HTMLCanvasElement;
};

/* ── state ───────────────────────────────────────────── */

/** Which list is playing, and which is on screen. Two names for two things:
    a listener can read the episodes while a song plays. */
type Mode = 'track' | 'story';
type Tab = 'songs' | 'stories';
/** What the listener last asked for, which is what a dropped track is judged
    against: still 'play' means reconnect, 'pause' means leave it alone. */
type Intent = 'idle' | 'play' | 'pause' | 'stop';

interface State {
  mode: Mode;
  /** Index into the playing list, -1 before the playlist has started. */
  ti: number;
  tracks: Item[];
  eps: Item[];
  /** What the feed says the show is called, and where it lives. */
  show: { name: string; link: string } | null;
  tab: Tab;
  /** The list the address is naming while nothing is playing. */
  route: '' | 'playlist' | 'podcast';
  /** The playing episode is showing what it is about. */
  epOpen: boolean;
  feedErr: boolean;
  playing: boolean;
  vol: number;
  cur: number;
  dur: number;
  shuffle: boolean;
  /** The name of the theme on, which is what survives the list changing
      under it: the desktop's own theme appears at the top of the list the
      moment the extension offers one, and an index would then mean the
      theme below the one the listener picked. */
  skin: string;
  themeOpen: boolean;
  lyricsOpen: boolean;
  status: string;
  fit: number;
  /** What is in the find box. Filters what is on screen and nothing else. */
  query: string;
}

var S: State = {
  mode: 'track',
  ti: -1,
  tracks: [],
  eps: [],
  show: null,
  tab: 'songs',
  route: '',
  epOpen: true,
  feedErr: false,
  playing: false,
  vol: 0.8,
  cur: 0,
  dur: 0,
  shuffle: false,
  skin: SKINS[0]!.name,
  themeOpen: false,
  lyricsOpen: false,
  status: 'ready',
  fit: 1,
  query: ''
};

/* Every theme the picker offers: the twenty-four in the list, and — first,
   when a browser is offering it — the one the desktop is actually wearing.
   src/scripts/omarchy-theme.ts is where that comes from. */
var skins: Skin[] = SKINS.slice();

function skinNamed(name: string): Skin {
  for (var i = 0; i < skins.length; i++) {
    if (skins[i]!.name === name) return skins[i]!;
  }
  return skins[0]!;
}

/** The theme the deck last painted, which is where a visit with no desktop
    palette picks up from. */
var restored = '';
/** The theme the listener picked out of the menu, if they ever did. */
var pinned = '';
try {
  restored = localStorage.getItem(STORE_KEY) || '';
  pinned = localStorage.getItem(STORE_PIN) || '';
} catch (e) { /* private mode */ }

var start = pinned || restored;
if (start && SKINS.some(function (k) { return k.name === start; })) S.skin = start;

/** Whether the desktop's theme, when there is one, is what to wear. */
function followsDesktop(): boolean {
  return !pinned || pinned === DESKTOP;
}

var lev = new Float32Array(BAR_COUNT);
// The derived theme, held rather than recomputed for every frame the field
// paints: it is twenty-odd colour mixes and it only changes when the skin does.
var curTheme: Theme | null = null;
var simVis = true;
var audio: HTMLMediaElement;
var music: HTMLMediaElement;
var pod: HTMLMediaElement;
var ctx: AudioContext | null = null;
var analyser: AnalyserNode | null = null;
var freq: Uint8Array<ArrayBuffer> | null = null;
var loadedSrc = '';
var intent: Intent = 'idle';
var gestured = false; // the listener has touched the page at least once
var wiring = false; // an audio graph waiting on its context to start
/** An autoplay the browser refused, waiting for a gesture. */
var armed: { src: string; mode: Mode; ti: number } | null = null;
var linkPending = false; // a link named a track; the lists decide which
/* The key of an item an address named, until the list has actually shown it.
 *
 * A key rather than a flag, because of what a permalink does on the way in.
 * It paints three times: once with the item baked into the page and nothing
 * else, once when the manifest lands — where the row still marked as playing
 * is whatever index the seeded copy had, which is not this song — and once
 * more when the real list has said where the song really sits. A bare flag
 * gets spent on the middle one and scrolls to the wrong row. */
var revealKey = '';
/* Whether the listener named the item that is playing, by following a link
   or pressing a row, as against the deck having started the playlist by
   itself. Only a named item takes over the address: /, /playlist and
   /podcast are pages of their own and stay where they are. */
var chose = false;
var loadsLeft = SHOW_PODCAST ? 2 : 1; // a link waits on the lists there are
var keptTracks = false; // the playlist on screen is the copy from last visit
/** A lyric sheet, or an episode's chapters: the same stamped lines either way.
    `timed` is false for a sheet somebody wrote without timings, which is all
    most people will want to write; `jump` makes each line pressable. */
interface Sheet {
  lines: Stamped[];
  timed: boolean;
  jump?: boolean;
}

/** A parsed sheet, or why there is not one, by the item's key. */
var sheets: Record<string, Sheet | 'loading' | 'none' | 'error'> = {};
var lyricsKey = ''; // whose sheet the lyrics box is holding
// The stamped sheet being followed, wherever it lives: the lyrics box for a
// song, the open episode inside the podcast list for a chapter list.
var sheetOn: {
  lines: Stamped[] | null;
  node: HTMLElement | null;
  scroll: HTMLElement | null;
} = { lines: null, node: null, scroll: null };
var lyricsLine = -1; // the line the audio is on
var handScrolled = 0, autoScrolled = 0; // who moved the sheet last, and when
var retryN = 0, lastProgress = 0;
var retryTimer: ReturnType<typeof setTimeout> | null = null;

var el = {} as Els;
// The state cell of the row that is playing. Held so pressing pause can say
// so in the list without rebuilding it: the list is also what the listener
// is reading, and a rebuild throws away their scroll position.
var stateCell: HTMLElement | null = null;
/* A shuffle is a listening run, not a permanently reordered playlist. The
   current song begins it; `remaining` holds each other track once, while
   `history` lets Previous mean the song the listener actually just heard. */
var shuffleHistory: number[] = [];
var shuffleAt = -1;
var shuffleRemaining: number[] = [];
/** The row that cell sits in, for the one thing that wants the whole row. */
var playingRow: HTMLElement | null = null;
/** And which item that row is, which is not always the one being looked for. */
var playingKey = '';

/* ── theme application ───────────────────────────────── */

function applyTheme() {
  var k = curTheme = derive(skinNamed(S.skin));
  markFieldStale(); // a still field has to be repainted in the new inks
  var r = document.documentElement.style;
  r.setProperty('--bg', k.bg);
  r.setProperty('--fg', k.fg);
  r.setProperty('--ac', k.ac);
  r.setProperty('--bd', k.bd);
  r.setProperty('--bdF', k.bdF);
  r.setProperty('--c2', k.c2);
  r.setProperty('--c3', k.c3);
  r.setProperty('--rowOn', k.rowOn);
  r.setProperty('--rowHov', k.rowHov);
  r.setProperty('--trk', k.trk);
  r.setProperty('--lcd', k.lcd);
  r.setProperty('--acFg', k.acFg);
  r.setProperty('--acHi', k.acHi);
  r.setProperty('--g1', k.g1);
  r.setProperty('--g2', k.g2);
  r.setProperty('--meter-low', k.mLow);
  r.setProperty('--meter-mid', k.mMid);
  r.setProperty('--meter-high', k.mHigh);
  r.setProperty('--field-dim', k.fDim);
  r.setProperty('--field-mid', k.fMid);
  r.setProperty('--field-lit', k.fLit);
  r.setProperty('--field-hover', k.fHov);
  r.setProperty('--field-crest', k.fCrest);
  r.setProperty('--scan', 'repeating-linear-gradient(180deg, ' +
    (k.light ? 'rgba(0,0,0,.055) 0 1px, transparent 1px 4px'
             : 'rgba(0,0,0,.42) 0 2px, transparent 2px 4px') + ')');

  el.skinName.textContent = skinLabel(k.name);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', k.bg);

  Array.from(el.themeMenu.children).forEach(function (li) {
    var on = (li as HTMLElement).dataset.skin === S.skin;
    li.classList.toggle('is-on', on);
    li.querySelector('button')?.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  try { localStorage.setItem(STORE_KEY, k.name); } catch (e) { /* private mode */ }
}

/* The desktop's theme, arriving or changing.
 *
 * It goes first in the list, and it is what a listener gets on a first visit
 * if their browser is offering one: opening this deck on an Omarchy machine
 * should look like that machine. Anyone who has since picked a theme keeps
 * the one they picked — the palette still lands, so the entry is there to go
 * back to, it just does not take over.
 *
 * A desktop theme change while the deck is open repaints it, because that is
 * the whole point of following one. */
function onDesktopPalette(skin: Skin | null) {
  var had = skins[0]!.name === DESKTOP;

  if (!skin) {
    // The extension was there and the palette went away: a stopped host, or
    // the theme was uninstalled. Fall back to the list.
    if (!had) return;
    skins = SKINS.slice();
    if (S.skin === DESKTOP) {
      var back = pinned && pinned !== DESKTOP ? pinned : restored;
      S.skin = back && SKINS.some(function (k) { return k.name === back; })
        ? back
        : SKINS[0]!.name;
    }
    repaintTheme();
    return;
  }

  var was = had ? skins[0]! : null;
  skins = [skin].concat(SKINS);
  /* On offer and nobody has said otherwise: this is the theme to wear. The
     machine is running it, and a deck that looks like the desktop it is
     playing on is the whole of the idea. */
  if (followsDesktop()) S.skin = DESKTOP;

  // Nothing to repaint if it is the same palette, and it was already on.
  if (was && S.skin !== DESKTOP &&
      was.bg === skin.bg && was.fg === skin.fg &&
      was.ac === skin.ac && was.bd === skin.bd) return;

  repaintTheme();
}

/* boot() builds the menu and paints the theme itself, straight after the
   first palette lands. Doing it twice would throw the menu away and rebuild
   it before anything had been on screen. */
var booted = false;

function repaintTheme() {
  if (!booted) return;
  buildThemeMenu();
  applyTheme();
}

/* The desktop skin has no name of its own — it wears whatever the machine is
   wearing — so the picker says both: "desktop · ethereal". */
function skinLabel(name: string): string {
  if (name !== DESKTOP) return name;
  var live = desktopName();
  return live ? DESKTOP + ' · ' + live : DESKTOP;
}

function buildThemeMenu() {
  el.themeMenu.innerHTML = '';
  var frag = document.createDocumentFragment();
  skins.forEach(function (d) {
    var li = document.createElement('li');
    li.setAttribute('role', 'none');
    li.dataset.skin = d.name;
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.innerHTML =
      '<span class="sw" aria-hidden="true">' +
        '<span style="background:' + d.bg + '"></span>' +
        '<span style="background:' + d.ac + '"></span>' +
        '<span style="background:' + d.fg + '"></span>' +
      '</span><span class="menu-name"></span>';
    b.querySelector('.menu-name')!.textContent = skinLabel(d.name);
    b.addEventListener('click', function () {
      S.skin = d.name;
      /* Picked by hand, so it stays picked — including "desktop", which is
         how somebody who once pinned a theme goes back to following the
         machine. */
      pinned = d.name;
      try { localStorage.setItem(STORE_PIN, pinned); } catch (e) { /* private mode */ }
      closeThemes();
      applyTheme();
    });
    li.appendChild(b);
    frag.appendChild(li);
  });
  el.themeMenu.appendChild(frag);
}

function openThemes() {
  S.themeOpen = true;
  el.themeMenu.hidden = false;
  el.themeBtn.setAttribute('aria-expanded', 'true');
  el.themeCaret.classList.add('is-open');
}

function closeThemes() {
  S.themeOpen = false;
  el.themeMenu.hidden = true;
  el.themeBtn.setAttribute('aria-expanded', 'false');
  el.themeCaret.classList.remove('is-open');
}

/* ── station list ────────────────────────────────────── */



/* ── visualiser bars ─────────────────────────────────── */

function buildBars() {
  el.vis.innerHTML = '';
  var frag = document.createDocumentFragment();
  for (var i = 0; i < BAR_COUNT; i++) frag.appendChild(document.createElement('span'));
  el.vis.appendChild(frag);
}

/* ── audio ───────────────────────────────────────────── */

/* ── install ─────────────────────────────────────────
   Chrome and Edge fire beforeinstallprompt and let the page choose when
   to ask, so the button appears only once the browser has said it would
   actually install, never as a control that does nothing. iOS has no
   such event and installs through the share sheet, so there it says how
   instead of pretending it can do it. */

/* beforeinstallprompt is not in the DOM lib: it is Chrome and Edge's, and
   this is the shape of it. navigator.standalone is iOS Safari's, and is
   false there until the page is launched from the home screen. */
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
type IosNavigator = Navigator & { standalone?: boolean };

var installEvent: InstallPrompt | null = null;

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as IosNavigator).standalone === true;
}

function wireInstall() {
  // Already an app: nothing to offer.
  if (isStandalone()) return;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installEvent = e as InstallPrompt;
    el.installBtn.hidden = false;
  });

  window.addEventListener('appinstalled', function () {
    installEvent = null;
    el.installBtn.hidden = true;
    setStatus('installed');
  });

  el.installBtn.addEventListener('click', function () {
    if (installEvent) {
      installEvent.prompt();
      installEvent.userChoice.then(function (c) {
        if (c && c.outcome === 'accepted') el.installBtn.hidden = true;
        installEvent = null;
      });
      return;
    }
    setStatus('share \u25b8 add to home screen');
  });

  // Launched from a browser on iOS, where there is no event to wait for.
  if ((window.navigator as IosNavigator).standalone === false) el.installBtn.hidden = false;
}

/* ── media session ───────────────────────────────────
   Audio keeps playing with the screen off because it is an <audio>
   element; what this adds is being able to control it while it does.
   The lock screen and the notification shade get the title, artwork and
   working buttons, and the keyboard media keys reach the deck. Without
   it a backgrounded stream is audible but unreachable. */

var MEDIA_ART = [
  { src: 'assets/images/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: 'assets/images/icon-512.png', sizes: '512x512', type: 'image/png' }
];

function mediaSupported() {
  return 'mediaSession' in navigator && typeof window.MediaMetadata === 'function';
}

function setMediaMeta(title: string, artist: string) {
  if (!mediaSupported()) return;
  try {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: title || 'Omarchy Radio',
      artist: artist || 'Omarchy',
      album: 'Omarchy Radio',
      artwork: MEDIA_ART
    });
  } catch (e) { /* older engines refuse the constructor */ }
}

function setMediaState() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = S.playing ? 'playing' : 'paused';
  } catch (e) { /* not everywhere */ }
}

function wireMediaSession() {
  if (!('mediaSession' in navigator)) return;
  function on(action: MediaSessionAction, fn: MediaSessionActionHandler) {
    // An engine that does not know an action throws rather than ignoring it.
    try { navigator.mediaSession.setActionHandler(action, fn); } catch (e) { /* skip */ }
  }
  on('play', function () { if (audio && audio.paused) toggle(); });
  on('pause', function () { if (audio && !audio.paused) toggle(); });
  on('stop', stop);
  on('nexttrack', next);
  on('previoustrack', prev);
}

/* ── reconnect ───────────────────────────────────────
   A track stops arriving for ordinary reasons: a flaky link, a laptop
   waking, a host having a bad minute. The element reports that as 'error'
   or sometimes as nothing at all, which is what the watchdog below is for.
   Retry only while the listener still wants sound, back off rather than
   hammering, and say so rather than going quiet when the attempts run
   out. */

var RETRY_MAX = 8;
var STALL_AFTER = 15000; // no progress for this long counts as a drop

function cancelReconnect() {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  retryN = 0;
}

function reconnectNow() {
  if (intent !== 'play') return;
  play(wantedSrc(), S.mode, S.ti);
  // play() ends on 'connecting…'; say which attempt this is instead.
  setStatus('reconnecting ' + retryN + '/' + RETRY_MAX + '…');
}

function scheduleReconnect() {
  if (intent !== 'play' || retryTimer) return;
  S.playing = false;
  paintTransport();

  if (retryN >= RETRY_MAX) {
    setStatus('that one would not play');
    return;
  }

  // No point spending attempts while the machine knows it is offline. The
  // online listener picks it up the moment the link comes back.
  if (navigator.onLine === false) { setStatus('waiting for network'); return; }

  var wait = Math.min(30000, 1000 * Math.pow(2, retryN));
  retryN++;
  setStatus('reconnecting in ' + Math.round(wait / 1000) + 's (' + retryN + '/' + RETRY_MAX + ')');
  retryTimer = setTimeout(function () {
    retryTimer = null;
    reconnectNow();
  }, wait);
}

// Covers the silent case: still nominally playing, but no audio has
// arrived for a while and no event ever fired.
function watchdog() {
  if (intent !== 'play' || retryTimer) return;
  if (!audio || audio.paused) return;
  if (Date.now() - lastProgress < STALL_AFTER) return;
  scheduleReconnect();
}

/* Two elements, one deck. The analyser can only be handed a source it is
   allowed to read: the songs are served from this origin, so they run
   through the graph and drive a real spectrum. An episode comes from the
   show's host, whose download link
   redirects through an address that sends no such header, and a source the
   graph is not allowed to read is silence rather than an error. So episodes
   play on an element the graph never touches, and the bars simulate while
   one does — the same stand-in used before the first gesture.

   Every handler asks first whether it is still the element in use, because
   switching pauses the other one and a pause fires an event either way. */
/* A <video>, for a deck that plays no video.
 *
 * This is the whole of why the deck can start on arrival. Browsers refuse an
 * audible autoplay to a site nobody has engaged with, and the exemption
 * everybody quotes — "a muted autoplay is always allowed" — turns out to be
 * an exemption for <video> and not for <audio>. Measured, under both of
 * Chromium's restrictive policies:
 *
 *     new Audio(src), muted        NotAllowedError
 *     new Audio(src), volume = 0   NotAllowedError
 *     <video>, muted               plays
 *
 * A media element with no picture is a perfectly ordinary thing for a <video>
 * to be, and every other part of this is identical: the same
 * HTMLMediaElement API, the same events, the same analyser node, the same
 * media session. It is never put in the document, so there is no frame to
 * lay out and nothing to show. playsInline is for iOS, which would otherwise
 * take a play() as a request to go fullscreen — and which is also the
 * platform where <audio> could never autoplay at all. */
function makeAudio(analysed: boolean): HTMLMediaElement {
  var a = document.createElement('video');
  a.preload = 'none';
  a.playsInline = true;
  // Nothing to cast, and no picture to send anywhere.
  a.disableRemotePlayback = true;
  if (analysed) a.crossOrigin = 'anonymous';
  a.volume = S.vol;

  function mine() { return audio === a; }

  a.addEventListener('timeupdate', function () {
    if (!mine()) return;
    lastProgress = Date.now();
    S.cur = a.currentTime || 0;
    S.dur = isFinite(a.duration) ? a.duration : 0;
    paintClock();
    syncLyrics();
  });
  // The end of one is the start of the next, and the end of the last is
  // the start of the first. That is the whole of the rotation.
  a.addEventListener('ended', function () {
    if (mine()) next();
  });
  a.addEventListener('playing', function () {
    if (!mine()) return;
    cancelReconnect();
    armed = null; // whatever was owed, it is playing now
    lastProgress = Date.now();
    S.playing = true;
    // Playing, and whether it can be heard is the other half of the news.
    setStatus(a.muted ? mutedMessage() : 'playing');
    paintTransport();
  });
  a.addEventListener('pause', function () {
    if (!mine()) return;
    // pause fires asynchronously, after stop() has already set its status.
    // Only a deliberate pause calls off a reconnect; a dropped stream also
    // pauses the element, and there intent is still 'play'.
    if (intent === 'pause' || intent === 'stop') { cancelReconnect(); armed = null; }
    S.playing = false;
    setStatus(intent === 'stop' ? 'stopped' : 'paused');
    paintTransport();
  });
  a.addEventListener('waiting', function () { if (mine()) setStatus('buffering…'); });
  a.addEventListener('error', function () { if (mine()) scheduleReconnect(); });

  return a;
}

function buildAudio() {
  music = makeAudio(true);
  pod = makeAudio(false);
  audio = music;
}

// Only one of them is ever the deck. The other stops rather than sitting
// paused halfway through an episode while a song plays over it.
function useElement(a: HTMLMediaElement) {
  if (audio === a) return;
  var was = audio;
  audio = a; // before the pause, so the old element's handler stands down
  try { was.pause(); } catch (e) { /* nothing was loaded */ }
  audio.volume = S.vol;
}

/* iOS ignores writes to HTMLMediaElement.volume, leaving the hardware
   buttons in charge. The knob still turned and the number still moved,
   it just did nothing to the sound, which is worse than not offering it.
   Feature detected rather than sniffed, so it corrects itself if the
   platform ever changes its mind. */
function volumeIsSettable(): boolean {
  if (!audio) return true;
  var prev = audio.volume;
  var probe = prev > 0.5 ? 0.25 : 0.75;
  try {
    audio.volume = probe;
    var worked = Math.abs(audio.volume - probe) < 0.01;
    audio.volume = prev;
    return worked;
  } catch (e) {
    return false;
  }
}

/* Connecting the element to an analyser takes its sound with it: from then
   on the deck is only audible if the context is running. A context built
   without a user gesture starts suspended and may refuse to resume, so the
   element is handed over only once the context is known to be running.
   Until then the simulated bars stand in, which costs a spectrum rather
   than the station. */
function wireGraph() {
  if (ctx || wiring || !music) return;
  if (!gestured) return; // nothing to spend on a resume yet
  try {
    var C = window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!C) return;
    var c = new C();
    wiring = true;

    var give_up = function () {
      wiring = false;
      simVis = true;
      if (c.close) c.close();
    };

    var take_over = function () {
      if (c.state !== 'running') { give_up(); return; }
      var src = c.createMediaElementSource(music);
      var an = c.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.75;
      src.connect(an);
      an.connect(c.destination);
      ctx = c;
      analyser = an;
      freq = new Uint8Array(an.frequencyBinCount);
      simVis = false;
      wiring = false;
    };

    if (c.state === 'running') take_over();
    else c.resume().then(take_over, give_up);
  } catch (e) {
    wiring = false;
    simVis = true;
  }
}

// The list the mode names, the list on screen, and the item playing out of
// the first of them.
function playingList(): Item[] {
  return S.mode === 'story' ? S.eps : S.tracks;
}

function onScreenList(): Item[] { return S.tab === 'stories' ? S.eps : S.tracks; }

/* ── find ────────────────────────────────────────────────
   Thirty-odd songs is a list you read. A hundred is a list you search.

   Every word typed has to appear somewhere in the row — the title, and
   whoever made it — so "koontz fix" finds the Kevin Koontz song about fixing
   everything and nothing else. Folded on both sides, so an accent nobody is
   going to type is not the difference between finding a song and not.

   It leaves the address alone on purpose. Everything else the deck does to
   what is on screen goes into the path, because those are places you can send
   somebody; a half-typed query is not one. */

/** What a row is searched by. */
function haystack(item: Item): string {
  return fold(item.title + ' ' + (item.artist || ''));
}

function matches(item: Item, terms: string[]): boolean {
  if (!terms.length) return true;
  var hay = haystack(item);
  for (var i = 0; i < terms.length; i++) {
    if (hay.indexOf(terms[i]!) < 0) return false;
  }
  return true;
}

function queryTerms(): string[] {
  var q = fold(S.query);
  return q ? q.split(' ') : [];
}

function setQuery(q: string) {
  if (S.query === q) return;
  S.query = q;
  revealKey = ''; // whoever is typing is looking through the list themselves

  el.tracks.scrollTop = 0;
  paintFind();
  paintTracks();
}

/* The hint doubles as the state of the box: the key that puts the cursor in
   it, and once there is something in it, the key that empties it. */
function paintFind() {
  el.findHint.textContent = S.query ? 'esc' : '/';
  el.findRow.classList.toggle('has-q', !!S.query);
  if (el.find instanceof HTMLInputElement && el.find.value !== S.query) {
    el.find.value = S.query;
  }
}

function nowItem(): Item | null {
  var l = playingList();
  return (l && l[S.ti]) || null;
}

function wantedSrc(): string {
  var it = nowItem();
  return it ? it.url : '';
}

function play(src: string, mode: Mode, ti: number) {
  intent = 'play';
  loadedSrc = src;
  useElement(mode === 'story' ? pod : music);
  wireGraph();
  if (ctx && ctx.state === 'suspended') ctx.resume();
  audio.src = src;
  audio.load();
  // Every attempt is an attempt at sound. A press earns an audible one where
  // an arrival did not, so being muted once is not being muted for good.
  audio.muted = false;
  var p = audio.play();
  // NotAllowedError is the autoplay block, the only rejection the listener
  // can actually act on. AbortError just means a later pause/load
  // superseded this call, and a source that will not load rejects here
  // too, where the reconnect path is the one that should speak.
  if (p && p.catch) p.catch(function (err) {
    if (err && err.name === 'NotAllowedError') silence(src, mode, ti);
  });
  S.mode = mode;
  S.ti = ti;
  S.cur = 0;
  S.dur = 0;
  lastProgress = Date.now();
  setStatus('connecting…');
  tearTape(); // a new record is a splice; the readout says so for a moment
  paintAll();
}

/* Joining the deck is the tune-in. There is no stream to fall back on, so
   the playlist is what answers: from the top, in order, round again at the
   end. Nothing about it was chosen, so it leaves the address alone — the
   page the listener opened stays the page they are on, and a permalink
   goes on meaning a song somebody picked. */
function autostart(how?: How) {
  if (!S.tracks.length) { setStatus('nothing in the playlist'); return; }
  chose = false;
  playFrom(S.tracks, 'track', 0, how);
}

function playFrom(list: Item[], mode: Mode, i: number, how?: How) {
  var it = list[i];
  if (!it) return;
  play(it.url, mode, i);
  syncRoute(how);
}

function shuffled(indices: number[]): number[] {
  for (var i = indices.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var swap = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = swap;
  }
  return indices;
}

function beginShuffle(i: number) {
  shuffleHistory = i >= 0 ? [i] : [];
  shuffleAt = shuffleHistory.length - 1;
  shuffleRemaining = shuffled(S.tracks.map(function (_, n) { return n; }).filter(function (n) {
    return n !== i;
  }));
}

function shuffleNext(): boolean {
  if (!S.tracks.length) return false;
  // Returning from Previous follows the run the listener has already made.
  if (shuffleAt < shuffleHistory.length - 1) {
    shuffleAt++;
    playFrom(S.tracks, 'track', shuffleHistory[shuffleAt]!);
    return true;
  }
  // One cycle visits every other song before it starts afresh. Leave the
  // current song out of the new bag so the seam can never repeat it.
  if (!shuffleRemaining.length) {
    shuffleRemaining = shuffled(S.tracks.map(function (_, n) { return n; }).filter(function (n) {
      return n !== S.ti;
    }));
  }
  var i = shuffleRemaining.pop();
  if (i === undefined) return false; // a one-track playlist stays put
  shuffleHistory.push(i);
  shuffleAt = shuffleHistory.length - 1;
  playFrom(S.tracks, 'track', i);
  return true;
}

function toggleShuffle() {
  S.shuffle = !S.shuffle;
  if (S.shuffle) beginShuffle(S.mode === 'track' ? S.ti : -1);
  else {
    shuffleHistory = [];
    shuffleAt = -1;
    shuffleRemaining = [];
  }
  paintTransport();
}

// The two ways in that mean the listener named this one: a row, or a link.
// Stepping with the transport goes through playFrom() and leaves that be.
function playTrack(i: number, how?: How) {
  chose = true;
  S.tab = 'songs';
  S.route = 'playlist';
  if (S.shuffle) beginShuffle(i);
  playFrom(S.tracks, 'track', i, how);
}

function playStory(i: number, how?: How) {
  chose = true;
  S.tab = 'stories';
  S.route = 'podcast';
  S.epOpen = true; // an episode just chosen shows what it is
  playFrom(S.eps, 'story', i, how);
}

function toggle() {
  /* Pressing play on a deck that is already playing silently is asking for
     the sound, not for a pause. It is the one press on this button that does
     not mean what the button's face says, and the status line is what asked
     for it. */
  if (silenced()) { unsilence(); return; }
  if (!audio.paused) { intent = 'pause'; cancelReconnect(); audio.pause(); return; }
  intent = 'play';
  var want = wantedSrc();
  // Pressed play before anything has started, or after a stop: the
  // playlist is what play means here.
  if (!want) { autostart(); return; }
  if (loadedSrc !== want) { play(want, S.mode, S.ti); return; }
  if (ctx && ctx.state === 'suspended') ctx.resume();
  var p = audio.play();
  if (p && p.catch) p.catch(function () {});
}

function stop() {
  intent = 'stop';
  cancelReconnect();
  // Pressing stop on an autoplay that never got permission still means no.
  armed = null;
  audio.pause();
  try { audio.currentTime = 0; } catch (e) { /* nothing loaded */ }
  loadedSrc = '';
  S.playing = false;
  S.cur = 0;
  setStatus('stopped');
  paintAll();
}

// These step whichever list is playing, and wrap: the last track runs into
// the first one. Transport rather than navigation, so they leave the
// history and — unless the listener had named a song — the address alone.
function next() {
  if (S.shuffle && S.mode === 'track' && shuffleNext()) return;
  var l = playingList();
  if (l && l.length) playFrom(l, S.mode, (S.ti + 1) % l.length);
}

function prev() {
  if (S.shuffle && S.mode === 'track') {
    if (shuffleAt <= 0) return;
    shuffleAt--;
    playFrom(S.tracks, 'track', shuffleHistory[shuffleAt]!);
    return;
  }
  var l = playingList();
  if (l && l.length) playFrom(l, S.mode, (S.ti - 1 + l.length) % l.length);
}

/* ── autoplay ────────────────────────────────────────
   Joining the site is the tune-in: the deck should already be playing by the
   time it has finished drawing.

   No browser grants an audible autoplay to a site the listener has not
   engaged with before, and there is no arguing with it. What every one of
   them does allow is a *muted* one — so that is what a refusal turns into.
   The deck starts anyway: the clock runs, the marquee is the song, the row
   says playing, and the first gesture turns the sound on where the track has
   got to. A radio somebody can watch running is a better answer than a dead
   deck asking to be clicked, and joining a song part-way through is what
   tuning in has always been.

   Only when even that is refused is there nothing left but to ask, which is
   what arm() is still for: iOS refuses it for an <audio> element. */

/** Playing, but silent, because the arrival was not allowed to be audible. */
function silenced(): boolean {
  return !!audio && audio.muted && !audio.paused;
}

function mutedMessage(): string {
  return window.matchMedia('(pointer: coarse)').matches
    ? 'playing muted · tap for sound'
    : 'playing muted · click for sound';
}

/** The audible attempt was refused. A muted one is not, so the deck plays. */
function silence(src: string, mode: Mode, ti: number) {
  audio.muted = true;
  var p = audio.play();
  if (p && p.catch) p.catch(function () {
    // Not even silently. Nothing left to do but say so and wait.
    audio.muted = false;
    arm(src, mode, ti);
  });
}

/** The gesture that buys the sound. Where the track has got to, not the top. */
function unsilence() {
  music.muted = false;
  pod.muted = false;
  if (!audio.paused) setStatus('playing');
}

function arm(src: string, mode: Mode, ti: number) {
  armed = { src: src, mode: mode, ti: ti };
  setStatus(window.matchMedia('(pointer: coarse)').matches
    ? 'tap anywhere to start'
    : 'click anywhere to start');
}

// A gesture that belongs to something else: a control whose own handler is
// about to run, the space binding, or a combination the browser will not
// count as engagement anyway.
function spokenFor(e: Event): boolean {
  if (e.type === 'keydown') {
    var k = e as KeyboardEvent;
    return k.code === 'Space' || k.ctrlKey || k.metaKey || k.altKey || k.key === 'Escape';
  }
  var t = e.target;
  return t instanceof Element && !!t.closest('button, a, [role="slider"]');
}

function firstGesture(e: Event) {
  if (!gestured) {
    gestured = true;
    // Also the first chance at a real spectrum: the audio graph needs a
    // context that is allowed to run, and this gesture is what buys one.
    wireGraph();
  }
  /* Already playing, silently, because the arrival was not allowed to be
     audible. This is the gesture that pays for the sound. A press on a
     control is left to that control, which knows what it meant. */
  if (silenced() && !spokenFor(e)) { unsilence(); return; }
  if (!armed || spokenFor(e)) return;
  var owed = armed;
  armed = null;
  if (intent === 'pause' || intent === 'stop') return; // they already said no
  play(owed.src, owed.mode, owed.ti);
}

function wireGestures() {
  // Capture, so this runs before a control's own handler decides the
  // gesture was meant for it.
  (['pointerdown', 'touchstart', 'keydown'] as const).forEach(function (t) {
    document.addEventListener(t, firstGesture, true);
  });
}

/* A link names one item out of a list, and the slugs come from the list,
   so a fetch used to stand between the arrival and the sound. That is
   silence on the one visit that asked for a particular song, and on engines
   where the press that opened the link expires, it is the permission gone
   with it.

   So the deck asks three things in turn, and the first to answer wins: the
   copy of the list kept from the last visit, then the item baked into this
   very page by the build, then — for a link the pages here do
   not know, which is how a brand new episode arrives — the lists as they
   load, in listSettled(). A page that named nothing has nothing to look
   up: the playlist starts itself, which is what every page here does when
   it is not asked for something in particular. */
function tuneIn() {
  var r = here();
  if (!r.known || !r.kind) { autostart('replace'); return; }
  S.route = r.kind;

  // A list, rather than something in one: read it while the playlist runs.
  if (!r.slug) { setTab(LISTS[r.kind].tab); autostart('replace'); return; }

  restoreList(r.kind);
  if (navigate(r, 'replace')) return;
  if (seedRoute(r) && navigate(r, 'replace')) return;
  linkPending = true;
}

// What was kept from the last visit. The whole list, so it goes on screen
// in full rather than as the one row a link named.
function restoreList(kind: Kind): boolean {
  if (kind === 'podcast') {
    /* A copy kept from when the podcast was switched on is not a reason to
       play it now: with the list gone the link has nothing to open. */
    var feed = SHOW_PODCAST ? readStories() : null;
    if (!feed) return false;
    applyFeed(feed);
    return true;
  }
  var kept = readManifest();
  if (!kept) return false;
  applyManifest(kept);
  keptTracks = true;
  return true;
}

/* The item this page was generated for. It answers when there is no kept
   list, and when what was kept is older than the item the link names —
   which is the case for every first visit from a shared link, the visit
   that most needs the sound to start. */
function seedRoute(r: Route): boolean {
  var raw = (window as unknown as { __ITEM__?: Item }).__ITEM__;
  if (!raw || raw.kind !== r.kind || raw.slug !== r.slug) return false;

  // The build knows the slug it wrote the page under, so it is taken
  // rather than worked out again from the title.
  var it = raw.kind === 'playlist' ? resolveTrack(raw) : raw;
  it.kind = raw.kind;
  it.slug = raw.slug;
  it.key = raw.kind + '/' + raw.slug;

  if (raw.kind === 'podcast') {
    if (!SHOW_PODCAST) return false;
    // Newer than the copy of the feed served from here, which is how it
    // came to be missing from it, and newest is the top of that list.
    S.eps = [it].concat(S.eps);
  } else {
    S.tracks = S.tracks.concat([it]);
    keptTracks = true; // the manifest still gets the last word
  }
  if (S.tab === LISTS[raw.kind].tab) paintTracks();
  return true;
}

/* ── stories ─────────────────────────────────────────
   A podcast is an RSS feed, and this reads it the way a podcast app does:
   the items, their audio, and the notes the show wrote. Nothing about the
   show is kept in this repo, so an episode appears here because it was
   published, not because anybody remembered to add it.

   An episode is not a three-minute song, so what it is about and where its
   parts start belong with it rather than behind a toggle: the podcast tab
   opens the playing episode in place, under its own row, with its chapters
   and then its notes. A stamped line in the description is a chapter, which
   is the same shape as a timed lyric sheet — so the chapters follow the
   audio the way a lyric does, and jump when pressed. */

var CHAPTER_LINE = /^(?:(\d+):)?(\d{1,2}):(\d{2})\s+(\S.*)$/;
var CHAPTER_HEAD = /^(chapters|timestamps|chapter markers)[:.]?$/i;
var BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6';

function xmlKid(node: Element, name: string): Element | null {
  for (var i = 0; i < node.children.length; i++) {
    var kid = node.children[i]!;
    if (kid.tagName === name) return kid;
  }
  return null;
}

function xmlText(node: Element, name: string): string {
  var n = xmlKid(node, name);
  return n ? (n.textContent || '').trim() : '';
}

function itunesText(node: Element, name: string): string {
  var n = node.getElementsByTagNameNS(ITUNES_NS, name)[0];
  return n ? (n.textContent || '').trim() : '';
}

/* The description arrives as the markup the show wrote it in. Blocks become
   lines, a list item keeps a bullet so the takeaways do not run together,
   and a link that is not already its own address says where it goes,
   because a line in this panel is text and cannot be clicked.

   Anything stamped with a time is a chapter rather than a note, wherever in
   the description it sits, and once the stamps are lifted out the heading
   above them has nothing left to head, so it goes too. */
function notesOf(markup: string): { lines: string[]; chapters: Stamped[] } {
  var lines: string[] = [], chapters: Stamped[] = [];
  if (!markup) return { lines: lines, chapters: chapters };

  var body = new DOMParser().parseFromString(markup, 'text/html').body;

  body.querySelectorAll('a[href]').forEach(function (a) {
    var txt = (a.textContent || '').trim();
    var href = a.getAttribute('href') || '';
    if (!href) return;
    if (!txt) a.textContent = href;
    else if (txt !== href && !/^https?:\/\//i.test(txt)) {
      a.textContent = txt + ' (' + href + ')';
    }
  });

  var blocks = body.querySelectorAll(BLOCKS);
  var raw: string[] = blocks.length
    ? Array.from(blocks, function (node) {
        // A block holding another block is a wrapper; the inner ones speak.
        if (node.querySelector(BLOCKS)) return '';
        var txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt) return '';
        return node.tagName === 'LI' ? '· ' + txt : txt;
      })
    // A description that is only text still has its own lines.
    : (body.textContent || '').split(/\n+/);

  raw.forEach(function (raw) {
    var line = raw.trim();
    if (!line) return;
    var m = CHAPTER_LINE.exec(line.replace(/^· /, ''));
    if (m) {
      chapters.push({
        t: (m[1] ? parseInt(m[1], 10) * 3600 : 0) +
          parseInt(m[2]!, 10) * 60 + parseInt(m[3]!, 10),
        txt: m[4]!.trim()
      });
      return;
    }
    lines.push(line);
  });

  if (chapters.length) {
    lines = lines.filter(function (l) { return !CHAPTER_HEAD.test(l); });
    chapters.sort(function (a, b) { return a.t - b.t; });
  }
  return { lines: lines, chapters: chapters };
}

interface Feed { show: string; link: string; episodes: Item[] }

function parseFeed(text: string): Feed {
  var doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('not a feed');
  var ch = doc.getElementsByTagName('channel')[0];
  if (!ch) throw new Error('not a feed');

  var show = xmlText(ch, 'title') || SHOW;
  var eps: Item[] = [];
  var items = ch.getElementsByTagName('item');

  for (var i = 0; i < items.length; i++) {
    var it = items[i]!;
    var enc = xmlKid(it, 'enclosure');
    var url = (enc && enc.getAttribute('url')) || '';
    var title = xmlText(it, 'title') || itunesText(it, 'title');
    if (!title || !url) continue;

    var notes = notesOf(xmlText(it, 'description') || itunesText(it, 'summary'));
    eps.push({
      title: title,
      // The show stands where the artist does, so the marquee, the lock
      // screen and the media keys all read an episode without a special case.
      artist: show,
      url: url,
      ms: Date.parse(xmlText(it, 'pubDate')) || 0,
      secs: hms(itunesText(it, 'duration')),
      explicit: /^(yes|true)$/i.test(itunesText(it, 'explicit')),
      notes: notes.lines,
      chapters: notes.chapters
    } as Item);
  }

  // Newest first, the way a show is read. The list numbers them from the
  // other end, so episode 01 stays episode 01 as the show grows.
  eps.sort(function (a, b) { return (b.ms || 0) - (a.ms || 0); });

  return { show: show, link: xmlText(ch, 'link') || STORIES_HOME, episodes: eps };
}

function applyFeed(f: Feed) {
  S.show = { name: f.show, link: f.link };
  S.eps = f.episodes || [];
  assignSlugs(S.eps, 'podcast');
  if (S.tab === 'stories') paintTracks();
}

function readStories(): Feed | null {
  try { return JSON.parse(localStorage.getItem(STORE_STORIES) || 'null'); } catch (e) { return null; }
}

function saveStories(f: Feed) {
  try { localStorage.setItem(STORE_STORIES, JSON.stringify(f)); } catch (e) { /* private mode */ }
}

function loadStories() {
  fetch(STORIES_FEED).then(function (r) {
    if (!r.ok) throw new Error('feed ' + r.status);
    return r.text();
  }).then(function (t) {
    var f = parseFeed(t);
    applyFeed(f);
    saveStories(f);
    S.feedErr = false;
    listSettled();
  }).catch(function () {
    /* Offline, or the feed's host would not let a browser read it. The copy
       kept from the last visit still plays; with nothing kept the panel says
       so and points at the show. */
    S.feedErr = !S.eps.length;
    if (S.tab === 'stories') paintTracks();
    listSettled();
  });
}

function epNumber(i: number): number { return S.eps.length - i; }

function applyManifest(j: Manifest | null) {
  S.tracks = ((j && j.tracks) || []).map(resolveTrack);
  assignSlugs(S.tracks, 'playlist');
  paintTracks();
}

/** tracks/playlist.json, as a contributor writes it. */
interface Manifest { tracks?: Item[] }

function readManifest(): Manifest | null {
  try { return JSON.parse(localStorage.getItem(STORE_TRACKS) || 'null'); } catch (e) { return null; }
}

function saveManifest(j: Manifest) {
  try { localStorage.setItem(STORE_TRACKS, JSON.stringify(j)); } catch (e) { /* private mode */ }
}

/* A link that names a song or an episode has to wait for the list it is in,
   and the two lists arrive separately. Whichever one answers gets its
   chance at the link; the playlist from the top is the fallback only once
   neither of them turned out to have it. */
function listSettled() {
  loadsLeft--;
  if (!linkPending) return;
  if (navigate(here(), 'replace')) { linkPending = false; return; }
  if (loadsLeft <= 0) {
    // Neither list had it: a renamed track, a typo, or an episode the show
    // published since the copy of the feed here was mirrored. The playlist
    // is never the wrong answer, and the address stops claiming otherwise.
    linkPending = false;
    S.route = '';
    autostart('replace');
  }
}

function loadTracks() {
  fetch(TRACKS_MANIFEST).then(function (r) {
    if (!r.ok) throw new Error('no playlist');
    return r.json() as Promise<Manifest>;
  }).then(function (j) {
    // What tuneIn() started, if anything, named by the one thing that
    // survives a reordering.
    var open = S.mode === 'track' && S.tracks[S.ti] ? S.tracks[S.ti].key : '';
    var waiting = linkPending;
    applyManifest(j);
    saveManifest(j);
    keptTracks = false;

    // A link that names a track opens on that track, and with nothing kept
    // this is the first moment it can. A slug that matches nothing — a
    // renamed track, a typo — is no reason to sit silent.
    listSettled();
    if (waiting) return;

    // Nor is an empty deck. Without a kept copy there was nothing to play
    // until this landed, and this is the moment the rotation can start.
    if (!nowItem()) { autostart('replace'); return; }

    // The kept copy picked the track; the real playlist gets the last word
    // on where it sits, and on whether it is still there at all.
    if (open) {
      var i = indexOfKey(S.tracks, open);
      if (i < 0) { autostart('replace'); return; }
      if (i !== S.ti) { S.ti = i; paintAll(); }
    }

    /* And on where its file is. A slug comes from the title, so a song whose
       file was renamed is still the same song at the same address — but the
       copy kept from the last visit named the old file, and the deck started
       playing it before this landed. The manifest is the authority on where
       a song lives, so if what is loaded is not what it now says, load that.
       Without this the element sits on a 404 until the reconnect budget
       happens to retry it. */
    if (S.mode === 'track' && loadedSrc && intent === 'play') {
      var want = wantedSrc();
      if (want && want !== loadedSrc) play(want, 'track', S.ti);
    }
  }).catch(function () {
    // Offline, or the manifest is gone. Whatever was kept still plays; with
    // nothing kept the playlist is simply empty.
    if (!keptTracks) { S.tracks = []; paintTracks(); }
    listSettled();
  });
}

// A contributed entry names its file and nothing else; encoding happens
// here so nobody has to hand-escape spaces or accents in the manifest. An
// entry that already carries a url is left alone.
//
// The entry is copied rather than rebuilt field by field, which is how
// "explicit" used to get lost on the way to the badge that was added for
// it, and how "lyrics" would have gone the same way.
function resolveTrack(t: Item): Item {
  if (t.url) return t;
  return Object.assign({}, t, { url: TRACKS_DIR + encodeURIComponent(t.file || '') });
}

/* ── painting ────────────────────────────────────────── */

function setStatus(s: string) {
  S.status = s;
  el.status.textContent = s;
}

function showName(): string { return (S.show && S.show.name) || SHOW; }
function showLink(): string { return (S.show && S.show.link) || STORIES_HOME; }

function paintLcd() {
  var it = nowItem();
  var story = S.mode === 'story' ? it : null;
  var t = S.mode === 'track' ? it : null;

  el.stationLabel.textContent = story
    ? showName().toLowerCase() + ' · ' + STORIES_TAG
    : STATION.name.toLowerCase() + ' · ' + STATION.tag;
  el.srcLabel.textContent = story
    ? 'podcast · episode ' + epNumber(S.ti)
    : t
      ? 'playlist · track ' + (S.ti + 1)
      : 'playlist';

  var marquee = it
    ? (it.title + '  —  ' + it.artist)
    : (STATION.name + '  —  ' + STATION.tag);
  Array.from(el.marq.children).forEach(function (n) { n.textContent = marquee; });

  setMediaMeta(it ? it.title : STATION.name, it ? it.artist : STATION.tag);

  el.artist.textContent = story
    ? [showName(), dateLabel(story.ms || 0), lengthLabel(story.secs || 0)]
        .filter(Boolean).join(' · ')
    : t
      ? (t.album || t.artist)
      : STATION.tag;

  /* The tab names the address, the way the title the page was served with
     does — a song's page still reads as the song while it is paused, which
     is how a listener finds it again among twenty tabs.

     Only when they named it, though, for the same reason the address only
     follows then: the playlist plays on the front page too, and a front
     page whose title is a song nobody asked for is what a crawler would
     index it under. */
  document.title = chose && story
    ? story.title + ' · ' + showName()
    : chose && t
      ? t.title + ' by ' + t.artist + ' · Omarchy Radio'
      : 'Omarchy Radio';

  paintClock();
}

function paintClock() {
  el.curTime.textContent = fmt(S.cur);
  el.durTime.textContent = fmt(S.dur);
  var pct = !S.dur ? 0 : Math.min(100, (S.cur / S.dur) * 100);
  el.seekFill.style.width = pct.toFixed(2) + '%';
  el.seekHead.style.left = pct.toFixed(2) + '%';
  el.seek.setAttribute('aria-valuenow', String(Math.round(pct)));
}

function paintTransport() {
  setMediaState();
  if (stateCell) stateCell.textContent = S.playing ? 'playing' : 'paused';
  /* Both faces are in the button; the class says which one is showing. The
     alternative is rewriting the button's contents forty times a minute to
     say the same two things. */
  el.toggle.classList.toggle('is-playing', S.playing);
  el.toggle.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  el.shuffle.hidden = S.mode === 'story';
  el.shuffle.classList.toggle('is-on', S.shuffle);
  el.shuffle.setAttribute('aria-pressed', String(S.shuffle));
  el.volRot.style.transform = 'rotate(' + (-135 + S.vol * 270) + 'deg)';
  el.volLabel.textContent = String(Math.round(S.vol * 100));
  el.volKnob.setAttribute('aria-valuenow', String(Math.round(S.vol * 100)));

  // 0..1 position for the phone layout, where the dial is a bar.
  el.volKnob.style.setProperty('--v', S.vol.toFixed(4));
}

/* ── routing ────────────────────────────────────
   The address is the state. Two lists, each with a path of its own:

     /                      the deck, playing the playlist
     /playlist              the songs
     /playlist/<song>       that song, playing
     /podcast               the episodes
     /podcast/<episode>     that episode, playing

   Those are real pages. Astro writes one per item — src/pages/playlist and
   src/pages/podcast — so a link that is shared arrives as a document of its
   own: the song's name in the tab, its own card where it is pasted, and the
   item itself baked into the page so the sound can start before anything is
   fetched.

   From there it is one deck. Pressing a row swaps the audio and rewrites
   the address, and nothing reloads — which is what keeps following a link
   from costing the listener whatever they were already hearing.

   Everything the deck does to the address goes through syncRoute().
   Everything the listener does to it — a link, the back button, a path
   typed by hand — comes back in through navigate(). */

/** Which list a path names, and how the deck holds it. */
var LISTS: Record<Kind, { tab: Tab; mode: Mode; list: () => Item[] }> = {
  playlist: { tab: 'songs',   mode: 'track', list: function () { return S.tracks; } },
  podcast:  { tab: 'stories', mode: 'story', list: function () { return S.eps; } }
};

/** An address, as parseRoute() reads it. `known` is false for one this deck
    does not own — a track file, the feed, some other page. */
interface Route {
  kind: '' | Kind;
  slug: string;
  known: boolean;
  /** A /#song link from before the paths existed. */
  legacy: boolean;
}

/* Pressing a row is a navigation and earns a history entry; stepping with the
   transport does not. */
type How = 'push' | 'replace';

function indexOfKey(list: Item[], key: string): number {
  for (var i = 0; i < list.length; i++) {
    if (list[i].key === key) return i;
  }
  return -1;
}

function permalink(t: Item): string { return location.origin + '/' + t.key; }

/* Tolerant on the way in, exact on the way out. A trailing slash, the
   .html of the file that served the page, a capital letter, an escaped
   character: all of them name the same route, and the deck then writes the
   one spelling worth sharing.

   An address this deck does not own is reported as such rather than guessed
   at, so a link to a track file or to the feed is left to the browser. */
function parseRoute(pathname: string, hash: string): Route {
  var p = String(pathname || '/');
  try { p = decodeURIComponent(p); } catch (e) { /* leave it as typed */ }
  p = p.toLowerCase()
    .replace(/\/index\.html?$/, '/')
    .replace(/\.html?$/, '')
    .replace(/\/+$/, '');
  var seg = p.split('/').filter(Boolean);

  if (!seg.length) return fromHash(hash);
  var kind = seg[0] as Kind;
  if (!LISTS[kind] || seg.length > 2) return stray();
  return route(kind, seg.length > 1 ? seg[1]! : '', false);
}

/* The links from before there were paths: /#song, and /#stories/episode.
   The slug is the part worth keeping, so they resolve here and the address
   is rewritten to the page that now holds them. */
function fromHash(hash: string): Route {
  var h = String(hash || '').replace(/^#/, '');
  try { h = decodeURIComponent(h); } catch (e) { /* as typed */ }
  h = h.toLowerCase();
  if (!h) return route('', '', false);
  var m = /^(stories|podcast|playlist)\/(.+)$/.exec(h);
  if (m) return route(m[1] === 'playlist' ? 'playlist' : 'podcast', m[2]!, true);
  if (/^[a-z0-9][a-z0-9-]*$/.test(h)) return route('playlist', h, true);
  return route('', '', false); // a fragment that names no track: it is home
}

function route(kind: '' | Kind, slug: string, legacy: boolean): Route {
  return {
    kind: kind,
    slug: String(slug || '').replace(/[^a-z0-9-]/g, ''),
    known: true,
    legacy: !!legacy
  };
}

function stray(): Route { return { kind: '', slug: '', known: false, legacy: false }; }

function here(): Route { return parseRoute(location.pathname, location.hash); }

/* The path for what the deck is showing: the item the listener named, if
   the panel is showing the list it came out of, and otherwise the list
   being read.

   A song the deck started by itself does not count. The playlist plays on
   every page, so if it did, /, /playlist and /podcast would each turn into
   a song's address a second after opening — three pages of this site that
   could never be linked to, and three canonical links pointing at a song
   nobody asked for. Press a row or follow a link and the address is
   yours; until then it stays the page it is. */
function wantedPath(): string {
  var it = nowItem();
  var showing = S.tab === 'stories' ? 'podcast' : 'playlist';
  if (chose && it && it.kind === showing) return '/' + it.key;
  return S.route ? '/' + S.route : '/';
}

/* Pressing a row is a navigation and earns a history entry: back returns
   the listener where they came from, the way a link should. Stepping with
   the transport buttons, or a track ending into the next one, does not —
   that would bury the way out under a playlist's worth of entries. */
function syncRoute(how?: How) {
  var want = wantedPath();
  if (location.pathname + location.hash !== want) {
    try {
      if (how === 'push' && location.pathname !== want) history.pushState(null, '', want);
      else history.replaceState(null, '', want);
    } catch (e) { /* file:// and the like */ }
  }
  paintCanonical();
}

// The card a crawler or a chat window reads comes from the generated page,
// but a deck that has been navigated for an hour should still not be
// claiming to be a different song than the one it is playing.
function paintCanonical() {
  var link = document.querySelector('link[rel="canonical"]');
  if (link) link.setAttribute('href', CANON + wantedPath());
}

/* Applies a route that came from outside: a link, the back button, a path
   typed by hand, or the page the listener arrived on. False means the route
   names an item that is not in the list — a renamed track, a typo, an
   episode published since the feed here was mirrored — and the caller
   decides whether to wait for the lists or fall back to the stream. */
function navigate(r: Route, how?: How): boolean {
  if (!r.known) return false;

  if (!r.kind) {
    // Home is the front of the deck: the songs, from the top. Whatever is
    // already playing keeps playing — going back to the front is not a
    // reason to lose your place in a song.
    S.route = '';
    chose = false;
    var moved = setTab('songs');
    if (!nowItem()) { autostart(how); return true; }
    if (moved) paintAll();
    syncRoute(how);
    return true;
  }

  var spec = LISTS[r.kind as Kind];
  if (!r.slug) { showTab(spec.tab, how); return true; }

  var i = indexOfKey(spec.list(), r.kind + '/' + r.slug);
  if (i < 0) return false;

  /* An address that names one item out of a list: a link somebody followed,
     the back button, a path typed by hand. Whatever the list turns out to
     look like, that item is what the listener came for and it should be on
     screen rather than however far down it happens to sit. */
  revealKey = r.kind + '/' + r.slug;

  /* Already the one playing: the back button landing on what is in the
     room, or a second press on the row that is going. Show it, do not
     start it again — twenty minutes into an episode, that is the whole
     difference between following a link and losing your place. */
  if (S.mode === spec.mode && S.ti === i) {
    if (S.tab !== spec.tab) showTab(spec.tab, 'replace');
    else {
      // Nothing to repaint, so nothing else would bring it into view.
      if (playingRow && revealNamedRow(playingRow)) revealKey = '';
      syncRoute(how);
    }
    return true;
  }

  if (r.kind === 'podcast') playStory(i, how);
  else playTrack(i, how);
  return true;
}

/* A press on a link inside the deck is handled here rather than by the
   browser, so the audio survives it. Everything that makes a link a link is
   left alone: a modified press, a middle press, one that opens in a new tab,
   and any address this deck does not route. */
function wireLinks() {
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var t = e.target;
    var a = t instanceof Element ? t.closest('a[href]') : null;
    if (!(a instanceof HTMLAnchorElement)) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;

    var u: URL;
    try { u = new URL(a.getAttribute('href')!, location.href); } catch (err) { return; }
    if (u.origin !== location.origin) return;

    var r = parseRoute(u.pathname, u.hash);
    if (!r.known) return; // a file, the feed, some other page: let it load

    e.preventDefault();
    if (navigate(r, 'push')) return;
    // Ours, and it names nothing this deck is holding. The page may well
    // exist, so let the browser go and get it rather than sitting here.
    location.href = u.href;
  });
}

function copyLink(t: Item) {
  var url = permalink(t);
  function fell_back() { setStatus(url); }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function () {
      setStatus('link copied');
    }, fell_back);
  } else {
    fell_back();
  }
}

/* Which of the two lists is showing, in the switch and in the title over
   it. The songs are a playlist of this station's own; the podcast is a
   show that happens to be listenable here. */
function paintTabs() {
  var stories = S.tab === 'stories';
  // With one list there is nothing to switch between, so the pair goes
  // rather than sitting there with a side that leads nowhere.
  el.seg.hidden = !SHOW_PODCAST;
  el.tabSongs.classList.toggle('is-on', !stories);
  el.tabPodcast.classList.toggle('is-on', stories);
  // aria-current, not aria-pressed: these are links to the two lists, and
  // the one being read is the current page rather than a button held down.
  setCurrent(el.tabSongs, !stories);
  setCurrent(el.tabPodcast, stories);
  el.playlistKind.textContent = stories ? 'episodes' : 'playlist';
  el.playlistName.textContent = stories
    ? showName().toLowerCase()
    : STATION.name.toLowerCase();
  el.tracks.setAttribute('aria-label', stories ? 'Episodes' : 'Playlist');
}

function setTab(tab: Tab): boolean {
  if (S.tab === tab) return false;
  S.tab = tab;
  // The sheet was opened on the other list's item; it does not follow.
  S.lyricsOpen = false;
  lyricsLine = -1;
  /* Nor does the query. It was typed at the songs, and carrying it over to
     the episodes shows a panel that says nothing matched. */
  S.query = '';
  paintFind();
  el.tracks.scrollTop = 0;
  return true;
}

function setCurrent(a: HTMLElement, on: boolean) {
  if (on) a.setAttribute('aria-current', 'page');
  else a.removeAttribute('aria-current');
}

function showTab(tab: Tab, how?: How) {
  if (tab === 'stories' && !SHOW_PODCAST) return;
  S.route = tab === 'stories' ? 'podcast' : 'playlist';
  if (setTab(tab)) paintAll();
  syncRoute(how);
}

/* A span the row markup below must carry. Reaching for one that is not there
   is a mistake in that string, and worth hearing about at once. */
function pick(root: HTMLElement, sel: string): HTMLElement {
  var node = root.querySelector(sel);
  if (!(node instanceof HTMLElement)) throw new Error('a row is missing ' + sel);
  return node;
}

/* The row the address named, brought into view.
 *
 * Only ever for a row somebody was sent to: a press on a row is a press on
 * something already on screen, and a track ending into the next one must not
 * move the list out from under whoever is reading further down it — the same
 * rule the lyric sheet follows about whose scroller it is.
 *
 * Left alone when the row is already in view, so following a link to the
 * second song does not scroll the list by four pixels to centre it. */
/** @returns whether this was a list the question could be answered on. */
function revealNamedRow(row: HTMLElement): boolean {
  var box = el.tracks;
  var top = row.offsetTop;
  var height = row.offsetHeight;
  if (!height) return false; // never laid out; nothing to measure yet
  /* Nothing to scroll. Either the row is already in view, or — on a permalink
     that has not read the manifest yet — this is not the list it is going to
     end up being, and the answer belongs to a later paint. */
  if (box.scrollHeight <= box.clientHeight + 1) return false;
  if (top >= box.scrollTop && top + height <= box.scrollTop + box.clientHeight) return true;
  box.scrollTop = Math.max(0, top - (box.clientHeight - height) / 2);
  return true;
}

function paintTracks() {
  var list = onScreenList();
  var stories = S.tab === 'stories';
  var terms = queryTerms();
  paintTabs();
  stateCell = null;
  playingRow = null;
  playingKey = '';
  el.tracks.innerHTML = '';
  var frag = document.createDocumentFragment();
  var shown = 0;
  /* The whole list is walked even while filtering: a row keeps the number it
     has in the list, not the number it has among the matches, the same way
     the page behind a permalink shows one row still numbered 02. */
  list.forEach(function (tr, i) {
    var on = i === S.ti && S.mode === (stories ? 'story' : 'track');
    if (!matches(tr, terms)) return;
    shown++;
    var li = document.createElement('li');
    if (on) li.className = 'is-on';
    /* A row is a link to the item it names: it can be opened in a tab of
       its own, copied out of the context menu, and read by anything that
       reads links. The press itself is still handled here, so following
       one costs nothing of what is already playing. */
    var b = document.createElement('a');
    b.href = '/' + tr.key;
    b.className = 'track' + (on ? ' is-on' : '');
    b.innerHTML =
      '<span class="tr-n"></span>' +
      '<span class="tr-t">' +
        '<span class="tr-line">' +
          '<span class="tr-title"></span>' +
          '<span class="tr-ex" hidden>explicit</span>' +
        '</span>' +
        '<span class="tr-artist"></span>' +
      '</span>' +
      '<span class="tr-s"><span class="tr-st"></span><span class="tr-c" hidden></span></span>';
    // Songs are numbered down the list. Episodes are numbered from the far
    // end, because the newest is at the top and episode 01 is episode 01.
    pick(b, '.tr-n').textContent =
      String(stories ? epNumber(i) : i + 1).padStart(2, '0');
    pick(b, '.tr-title').textContent = tr.title;
    pick(b, '.tr-ex').hidden = !tr.explicit;
    // An episode has no artist to name under the title: it has a date and
    // a length, which are the two things worth knowing before pressing it.
    pick(b, '.tr-artist').textContent = stories
      ? [dateLabel(tr.ms || 0), lengthLabel(tr.secs || 0)].filter(Boolean).join(' · ')
      : tr.artist;
    var state = pick(b, '.tr-st');
    state.textContent = on ? (S.playing ? 'playing' : 'paused') : '';
    if (on) { stateCell = state; playingRow = li; playingKey = tr.key; }

    /* The episode playing is also the one whose row opens and closes. A
       second press on a song starts it again, which is what a three-minute
       song is for; a second press on the episode you are 20 minutes into
       must never mean that, so it works the panel instead. */
    var opens = stories && on;
    if (opens) {
      var caret = pick(b, '.tr-c');
      caret.hidden = false;
      // The same table the page's own icons come out of.
      caret.innerHTML = iconSvg(S.epOpen ? 'caret-down' : 'caret-right');
      b.setAttribute('aria-expanded', S.epOpen ? 'true' : 'false');
    }
    b.addEventListener('click', function (ev) {
      // A modified press is the listener asking the browser for a tab of
      // its own, and the href is there so that they get one.
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      // A press is a press on a row that is already on screen: nothing to
      // reveal, and nothing later should scroll on this row's behalf.
      revealKey = '';
      if (opens) toggleEpisode();
      else if (stories) playStory(i, 'push');
      else playTrack(i, 'push');
    });

    // The same address, as the thing it is: press it and it is on the
    // clipboard, hold a modifier and the browser opens it.
    var link = document.createElement('a');
    link.href = '/' + tr.key;
    link.className = 'tr-link';
    link.textContent = '#';
    link.title = 'Permalink — press to copy';
    link.setAttribute('aria-label', 'Copy link to ' + tr.title);
    link.addEventListener('click', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      ev.preventDefault();
      ev.stopPropagation();
      copyLink(tr);
    });

    li.appendChild(b);
    li.appendChild(link);
    frag.appendChild(li);

    // The episode playing opens under its own row: this is the panel about
    // the show, so what the episode is and where its parts are belong here
    // rather than behind a button that hides the list to say it. Closed, the
    // list is a list of episodes again.
    if (opens && S.epOpen) frag.appendChild(episodeBody(tr));
  });
  el.tracks.appendChild(frag);

  /* Spent by the first paint that could actually do something about it.
     A permalink paints twice before the list is the real one: once with the
     item baked into the page and nothing else, and again when the manifest
     lands and the song turns out to be the thirty-third. The first of those
     has one row and nothing to scroll, so spending the flag there would be
     spending it on the paint that did not need it. */
  if (revealKey && playingRow && playingKey === revealKey &&
      revealNamedRow(playingRow)) revealKey = '';

  if (!S.lyricsOpen) paintTrackNote(terms.length ? shown : -1);
}

function toggleEpisode() {
  S.epOpen = !S.epOpen;
  // The chapters go with the panel; nothing left on screen to follow.
  if (!S.epOpen) sheetOn = { lines: null, node: null, scroll: null };
  paintTracks();
}

function epHeading(text: string): HTMLElement {
  var h = document.createElement('p');
  h.className = 'ep-h';
  h.textContent = text;
  return h;
}

function episodeBody(ep: Item): HTMLElement {
  var li = document.createElement('li');
  li.className = 'ep-open';

  var chapters = ep.chapters || [];
  if (chapters.length) {
    li.appendChild(epHeading(plural(chapters.length, 'chapter') + ' · press one to jump'));
    var ol = document.createElement('ol');
    ol.className = 'ep-chapters';
    // The same stamped sheet a lyric is, so it lights the chapter the
    // episode is in and can be pressed to get there.
    paintSheet({
      lines: chapters.map(function (c) { return { t: c.t, txt: c.txt }; }),
      timed: true,
      jump: true
    }, ol, null);
    li.appendChild(ol);
  }

  if (ep.notes && ep.notes.length) {
    li.appendChild(epHeading('about this episode'));
    var box = document.createElement('div');
    box.className = 'ep-notes';
    ep.notes.forEach(function (line) {
      var p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    });
    li.appendChild(box);
  }

  if (!chapters.length && !(ep.notes && ep.notes.length)) {
    li.appendChild(epHeading(ep.provisional
      ? 'reading the feed for what is in this one…'
      : 'the show sent no notes with this one'));
  }
  return li;
}

/**
 * @param shown How many rows survived the find box, or -1 when it is empty.
 *   A filtered list counts what matched rather than what there is; the deck
 *   is still playing all of them, which is what "on repeat" would claim.
 */
function paintTrackNote(shown = -1) {
  if (shown >= 0) {
    var of = S.tab === 'stories' ? S.eps.length : S.tracks.length;
    el.playlistNote.textContent = shown
      ? shown + ' of ' + plural(of, S.tab === 'stories' ? 'episode' : 'track')
      : 'nothing matched \u2014 ' + plural(of, S.tab === 'stories' ? 'episode' : 'track') + ' to look through';
    return;
  }
  if (S.tab === 'stories') { paintStoryNote(); return; }
  el.playlistNote.textContent = S.tracks.length
    ? S.tracks.length + ' tracks, on repeat'
    : 'nothing in the playlist yet';
}

/* The show is not ours, so the note says whose it is and where it lives —
   the one place on the deck that leads to the podcast itself. */
function paintStoryNote() {
  var note = el.playlistNote;
  var href = showLink();
  note.textContent = (S.eps.length
    ? plural(S.eps.length, 'episode')
    : S.feedErr
      ? 'the feed would not load'
      : 'reading the feed…') + ' · ';
  var a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = href.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  note.appendChild(a);
}

/* ── lyrics ──────────────────────────────────────────
   A sheet arrives the way a track does: a file in the repo named after
   the MP3, landing in the same pull request. Timestamps are optional. A
   sheet that has them follows the audio line by line; a sheet without is
   just a sheet, which is all most people will want to write. An episode
   has neither, so the button is only there for a song. */

function lyricsUrl(t: Item | null | undefined): string {
  if (!t || t.lyrics === false) return '';
  // A string names the file, for a sheet that does not match the MP3 name.
  if (typeof t.lyrics === 'string') return LYRICS_DIR + encodeURIComponent(t.lyrics);
  if (!t.file) return ''; // hosted elsewhere; there is nothing to guess at
  return LYRICS_DIR + encodeURIComponent(t.file.replace(/\.[^.]+$/, '') + '.lrc');
}

/* Accepts both shapes, because asking a songwriter to time their own
   chorus is a good way to get no sheet at all. "[ti:…]" and the other
   header tags describe the sheet rather than sing anything, so they go.
   One line can carry several stamps, which is how an LRC says a chorus
   comes round again. */
function parseLyrics(text: string): Sheet {
  var lines: Stamped[] = [];
  var timed = false;

  String(text).split(/\r?\n/).forEach(function (raw) {
    var line = raw.trim();
    if (!line || /^\[[a-z]{2,}:/i.test(line)) return;

    var times: number[] = [];
    var txt = line.replace(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g, function (_all, m: string, s: string) {
      times.push(parseInt(m, 10) * 60 + parseFloat(String(s).replace(':', '.')));
      return '';
    }).trim();

    if (!txt) return;
    if (times.length) {
      timed = true;
      times.forEach(function (t) { lines.push({ t: t, txt: txt }); });
    } else {
      lines.push({ t: -1, txt: txt });
    }
  });

  // Only a timed sheet has an order to put right; a plain one is already in
  // the order it was written.
  if (timed) lines.sort(function (a, b) { return a.t - b.t; });
  return { lines: lines, timed: timed };
}

function toggleLyrics() {
  S.lyricsOpen = !S.lyricsOpen;
  lyricsLine = -1;
  paintLyrics();
}

function seekTo(t: number) {
  if (!nowItem()) return;
  try { audio.currentTime = t; } catch (e) { return; }
  S.cur = t;
  paintClock();
  // Pressing a chapter is asking to hear it, not to mark the place.
  if (audio.paused) toggle();
}

function loadLyrics(t: Item) {
  var url = lyricsUrl(t);
  var slug = t.key;
  if (!url) { sheets[slug] = 'none'; paintLyrics(); return; }

  sheets[slug] = 'loading';
  fetch(url).then(function (r) {
    if (r.status === 404) return null; // no sheet for this one yet
    if (!r.ok) throw new Error('lyrics ' + r.status);
    return r.text();
  }).then(function (text) {
    sheets[slug] = text == null ? 'none' : parseLyrics(text);
    paintLyrics();
  }).catch(function () {
    sheets[slug] = 'error';
    paintLyrics();
  });
}

/* The scroller belongs to the listener the moment they touch it: a sheet
   that yanks itself back on the next line is unreadable. Our own scrolling
   fires the same event, so it is stamped and ignored. */
function lyricsScrolledByHand() {
  if (Date.now() - autoScrolled < 200) return;
  handScrolled = Date.now();
}

function scrollToLine(node: HTMLElement) {
  if (Date.now() - handScrolled < 6000) return;
  var box = sheetOn.scroll;
  if (!box) return;
  var to = node.offsetTop - (box.clientHeight / 2) + (node.offsetHeight / 2);
  autoScrolled = Date.now();
  box.scrollTop = Math.max(0, to);
}

// Which line the audio is on: the last one that has started.
function lineAt(lines: Stamped[], at: number): number {
  var i = -1;
  for (var n = 0; n < lines.length; n++) {
    if (lines[n]!.t <= at) i = n; else break;
  }
  return i;
}

/* Lights the line the audio is in, on whichever sheet is on screen. A sheet
   in its own box scrolls itself to keep up; chapters sitting inside the
   episode list do not, because that list is also how the listener is
   looking through the show. */
function syncLyrics() {
  if (!sheetOn.lines || !nowItem()) return;

  var i = lineAt(sheetOn.lines, S.cur);
  if (i === lyricsLine) return;

  var was = sheetOn.node!.children[lyricsLine];
  if (was) { was.classList.remove('is-on'); was.removeAttribute('aria-current'); }

  lyricsLine = i;
  var now = sheetOn.node!.children[i];
  if (!(now instanceof HTMLElement)) return;
  now.classList.add('is-on');
  now.setAttribute('aria-current', 'true');
  if (sheetOn.scroll) scrollToLine(now);
}

function paintSheet(sheet: Sheet, node: HTMLElement, scroll: HTMLElement | null) {
  node.innerHTML = '';
  var frag = document.createDocumentFragment();
  sheet.lines.forEach(function (l: Stamped) {
    var li = document.createElement('li');
    li.className = 'ly-line' + (sheet.jump ? ' ly-jump' : '');
    if (sheet.jump) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="ly-t"></span><span class="ly-x"></span>';
      pick(b, '.ly-t').textContent = fmt(l.t);
      pick(b, '.ly-x').textContent = l.txt;
      b.setAttribute('aria-label', 'Play from ' + fmt(l.t) + ' — ' + l.txt);
      b.addEventListener('click', function () { seekTo(l.t); });
      li.appendChild(b);
    } else {
      li.textContent = l.txt;
    }
    frag.appendChild(li);
  });
  node.appendChild(frag);
  node.classList.toggle('is-timed', sheet.timed);
  // Whatever was being followed is gone with the old lines.
  sheetOn = sheet.timed
    ? { lines: sheet.lines, node: node, scroll: scroll || null }
    : { lines: null, node: null, scroll: null };
  lyricsLine = -1;
}

/* One pass decides everything the panel shows: whether the button is
   there at all, which of the two lists the box holds, and what the note
   under it says. Called from paintAll(), so changing track is enough. */
function paintLyrics() {
  // A sheet is a song's. The podcast tab carries an episode's chapters and
  // notes in the list itself, so there is nothing to toggle there.
  var t = SHOW_LYRICS && S.mode === 'track' && S.tab === 'songs'
    ? S.tracks[S.ti] || null
    : null;

  // An episode carries its notes in the list itself, so there is nothing
  // to show here and nothing to offer.
  if (!t) {
    S.lyricsOpen = false;
    el.lyricsBtn.hidden = true;
  } else {
    el.lyricsBtn.hidden = false;
    el.lyricsBtn.classList.toggle('is-live', S.lyricsOpen);
    el.lyricsBtn.setAttribute('aria-expanded', S.lyricsOpen ? 'true' : 'false');
  }

  el.findRow.hidden = S.lyricsOpen;
  el.trHead.hidden = S.lyricsOpen;
  el.tracks.hidden = S.lyricsOpen;
  el.lyricsBox.hidden = !S.lyricsOpen;
  // The box is only ever open on a song, so past here there is one.
  if (!S.lyricsOpen || !t) { paintTrackNote(); return; }

  if (t.key !== lyricsKey) {
    lyricsKey = t.key;
    lyricsLine = -1;
    handScrolled = 0;
    el.lyrics.innerHTML = '';
    el.lyrics.scrollTop = 0;
  }

  var sheet = sheets[lyricsKey];
  if (sheet === undefined) { loadLyrics(t); sheet = 'loading'; }

  if (sheet === 'loading') { el.playlistNote.textContent = 'looking for a sheet…'; return; }
  if (sheet === 'error') { el.playlistNote.textContent = 'the sheet would not load'; return; }
  if (sheet === 'none' || !sheet.lines.length) {
    el.playlistNote.textContent = 'no lyrics on file — send them in a pull request';
    return;
  }

  if (!el.lyrics.children.length) paintSheet(sheet, el.lyrics, el.lyrics);
  el.playlistNote.textContent = sheet.timed
    ? plural(sheet.lines.length, 'line') + ' · following the track'
    : plural(sheet.lines.length, 'line');
  syncLyrics();
}

function paintAll() {
  paintTabs();
  paintFind();
  paintLcd();
  paintTransport();
  paintTracks();
  paintLyrics();
}

/* ── knobs ───────────────────────────────────────────── */

function knobDrag(e: PointerEvent, get: () => number, set: (v: number) => void) {
  e.preventDefault();
  var start = { x: e.clientX, y: e.clientY, v: get() };
  function move(ev: PointerEvent) { set(start.v + (start.y - ev.clientY + (ev.clientX - start.x)) / 140); }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function setVol(v: number) {
  S.vol = Math.min(1, Math.max(0, v));
  music.volume = S.vol;
  pod.volume = S.vol;
  paintTransport();
}


// The analyser is wired to the music element. Anything else is simulated.
function analysing(): boolean {
  return !!analyser && !!freq && !simVis && audio === music;
}

function frame() {
  var kids = el.vis.children;
  var n = lev.length;

  if (analyser && freq && analysing()) {
    analyser.getByteFrequencyData(freq);
    var step = Math.floor(freq.length * 0.7 / n) || 1;
    for (var i = 0; i < n; i++) {
      var v = (freq[i * step] || 0) / 255;
      lev[i] = Math.max(v, lev[i]! * 0.86);
    }
  } else {
    var t = performance.now() / 1000;
    var on = S.playing ? 1 : 0.05;
    for (var j = 0; j < n; j++) {
      var b = (Math.sin(t * 2.1 + j * 0.5) * 0.5 + 0.5) * (Math.sin(t * 5.7 + j * 1.31) * 0.5 + 0.5);
      lev[j] = lev[j]! * 0.72 + b * (1 - (j / n) * 0.55) * on * 0.28;
    }
  }

  /* A whole number of bricks, never a fraction of one. The pitch is the
     stylesheet's — .vis carries it as --seg — so this hands CSS the count and
     lets it do the multiplication, and a narrow layout can change the pitch
     without the deck being told. */
  for (var q = 0; q < kids.length && q < n; q++) {
    var lit = Math.max(1, Math.round(lev[q]! * METER_SEGS));
    var box = kids[q] as HTMLElement;
    if (box.dataset.lit === String(lit)) continue; // the same height as last frame
    box.dataset.lit = String(lit);
    box.style.height = 'calc(var(--seg) * ' + lit + ')';
  }

  /* A field that cannot move is still a field. It used to be skipped
     outright, which left reduced-motion readers a blank ground where
     everyone else got the texture; now it is painted once, standing
     still, and again only when the window or the theme changes. */
  if (reduceMotion) {
    if (!fieldPainted()) drawField(lev, curTheme || (curTheme = derive(skinNamed(S.skin))), true);
  } else drawField(lev, curTheme || (curTheme = derive(skinNamed(S.skin))));
  requestAnimationFrame(frame);
}

/* ── fit-to-viewport ─────────────────────────────────── */

function measureFit() {
  var w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;

  /* The head sets --fit before first paint, with the same expression written
     out inline in src/layouts/Deck.astro; this keeps it current on resize.
     Change one and the layout snaps on load. */
  var fit = w <= 900
    ? 1
    : Math.max(0.2, Math.min(1, (w - 40) / CANVAS_W, (h - 40) / CANVAS_H));
  if (fit === S.fit) return;
  S.fit = fit;
  document.documentElement.style.setProperty('--fit', String(fit));
}

/* ── boot ────────────────────────────────────────────── */

function boot() {
  var missing: string[] = [];
  IDS.forEach(function (id) {
    var node = document.getElementById(id);
    if (!node) { missing.push(id); return; }
    (el as Record<string, HTMLElement>)[id] = node;
  });
  if (missing.length) {
    /* A page missing one of these is a page the deck cannot paint. Saying
       which is the difference between a fixable mistake and a blank deck. */
    throw new Error('the page is missing #' + missing.join(', #'));
  }
  // The three the deck wants more than an HTMLElement's worth of. The type
  // says canvas; this is what makes that true rather than assumed.
  (['bg', 'lcdSrc', 'lcdOut'] as const).forEach(function (id) {
    if (!(el[id] instanceof HTMLCanvasElement)) throw new Error('#' + id + ' is not a canvas');
  });

  /* Fires at once if a palette is already on <html> — which is the usual
     case, the extension writing at document_start — and again whenever the
     desktop's theme changes. Before the menu is built, so the first thing
     painted is already the right theme rather than green for a tick.
     Without the extension it never fires and the deck is the twenty-four
     themes in the list. */
  watchDesktop(onDesktopPalette);
  buildThemeMenu();
  applyTheme();
  booted = true;
  buildBars();
  buildAudio();
  wireGestures();

  el.themeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    S.themeOpen ? closeThemes() : openThemes();
  });
  document.addEventListener('click', function (e) {
      var t = e.target;
    if (S.themeOpen && t instanceof Element && !t.closest('.picker')) closeThemes();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.themeOpen) { closeThemes(); el.themeBtn.focus(); }
  });

  el.toggle.addEventListener('click', toggle);
  el.stop.addEventListener('click', stop);
  el.next.addEventListener('click', next);
  el.prev.addEventListener('click', prev);
  el.shuffle.addEventListener('click', toggleShuffle);
  el.lyricsBtn.addEventListener('click', toggleLyrics);

  el.find.addEventListener('input', function () {
    setQuery(el.find instanceof HTMLInputElement ? el.find.value : '');
  });
  el.findHint.addEventListener('click', function () {
    // Printed as a key, but a phone has neither: pressing it does what the
    // key would have done.
    if (S.query) setQuery('');
    el.find.focus();
  });
  el.find.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    // Empty it first, and only give the field up on a second press: the
    // usual reason for reaching for escape here is to start again.
    if (S.query) setQuery('');
    else el.find.blur();
    e.preventDefault();
    e.stopPropagation(); // the theme menu is not what escape meant
  });
  el.lyrics.addEventListener('scroll', lyricsScrolledByHand);

  el.seek.addEventListener('click', function (e) {
    if (!nowItem() || !S.dur) return;
    var r = el.seek.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    audio.currentTime = p * S.dur;
    S.cur = p * S.dur;
    paintClock();
  });
  el.seek.addEventListener('keydown', function (e) {
    if (!nowItem() || !S.dur) return;
    if (e.key === 'ArrowRight') { audio.currentTime = Math.min(S.dur, audio.currentTime + 5); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
  });

  el.volKnob.addEventListener('pointerdown', function (e) {
    knobDrag(e, function () { return S.vol; }, setVol);
  });
  el.volKnob.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { setVol(S.vol + 0.05); e.preventDefault(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { setVol(S.vol - 0.05); e.preventDefault(); }
  });


  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t instanceof Element && t.matches('input, textarea, [contenteditable]')) return;
    if (e.code === 'Space') { toggle(); e.preventDefault(); }
    /* The terminal's own binding for this, and the box says so. A modifier
       means the listener is asking the browser for something else. */
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      el.find.focus();
      e.preventDefault();
    }
  });

  window.addEventListener('resize', function () { sizeField(); measureFit(); });
  if (window.ResizeObserver) {
    new ResizeObserver(function () { sizeField(); measureFit(); }).observe(document.body);
  }

  paintAll();
  initField(el.bg, el.app);
  sizeField();
  measureFit();

  /* The readout, played back as tape. Enhancement only: without the
     HTML-in-canvas API, or under a reduced-motion preference, this does
     nothing and the LCD keeps the CSS scanlines it was drawn with. Started
     after the first paint, so what it measures is the readout as laid out. */
  initLcdTape({ lcd: el.lcd, source: el.lcdSrc, content: el.lcdBody, output: el.lcdOut },
              reduceMotion);
  requestAnimationFrame(frame);

  tuneIn();
  loadTracks();
  if (SHOW_PODCAST) loadStories();
  setInterval(watchdog, 5000);

  window.addEventListener('online', function () {
    if (intent !== 'play' || (audio && !audio.paused)) return;
    cancelReconnect(); // a fresh link earns a fresh budget
    reconnectNow();
  });
  window.addEventListener('offline', function () {
    if (intent === 'play') setStatus('waiting for network');
  });

  wireMediaSession();
  wireInstall();

  /* The back and forward buttons, and any address typed over the one in
     the bar. A route that names nothing here is not a reason to go quiet:
     the playlist answers, and the address stops claiming otherwise. */
  window.addEventListener('popstate', function () {
    var r = here();
    if (navigate(r, 'replace')) return;
    S.route = r.known ? r.kind : '';
    chose = false;
    if (!nowItem()) autostart('replace');
    else syncRoute('replace');
  });

  /* A link from before the paths existed, followed in this tab: the
     fragment changes without the page moving, and popstate says nothing. */
  window.addEventListener('hashchange', function () {
    var r = here();
    if (r.legacy) navigate(r, 'replace');
  });

  wireLinks();

  if (!volumeIsSettable()) {
    var vw = el.volKnob.closest('.knob-wrap');
    if (vw instanceof HTMLElement) vw.hidden = true;
  }

  if ('serviceWorker' in navigator) {
    // Nothing here depends on it, so a failure is not worth reporting.
    navigator.serviceWorker.register('/sw.js').catch(function () { /* fine without */ });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
