/* Omarchy Radio — player logic.
   Vanilla reimplementation of the source design's component: theme derivation,
   ICY metadata parsing, live statistics, Web Audio analysis and the canvas
   background. No dependencies. */

(function () {
  'use strict';

  var HOST = 'https://radio.cliamp.stream';

  // Where this deck lives, for the canonical link the routes keep level with
  // whatever is playing. The pages themselves are written with it too, by
  // tools/build-routes.py.
  var CANON = 'https://radio.omarchy.org';

  // On-demand tracks live in the repo so they can arrive by pull request.
  // The live stream still comes from HOST.
  var TRACKS_DIR = '/tracks/';
  var TRACKS_MANIFEST = '/tracks/playlist.json';
  var LYRICS_DIR = '/tracks/lyrics/';

  /* Omarchy Stories is a podcast rather than a folder, so its episodes are
     read from the show's feed at load: the show publishes, the deck follows,
     and nothing here has to be bumped when an episode lands. Reading another
     origin's feed needs that origin's permission — if the list is ever empty,
     that is what to check, and this is the one line to point somewhere that
     grants it. */
  var SHOW_PODCAST = true;

  /* Off while there are no sheets in tracks/lyrics/. The button would open a
     box that says there is nothing in it, on every song. */
  var SHOW_LYRICS = false;

  /* The show's own feed, mirrored into this repo every hour by
     .github/workflows/stories.yml, and read from here rather than from the
     show's host. A browser will not read another site's feed unless that site
     sends a header saying it may, and Riverside send it on the preflight but
     not on the GET a plain read makes; mirroring the file means the player
     never has to ask. The episode audio is still fetched from the host, so
     their download figures still count what they always counted. */
  var STORIES_FEED = '/stories/feed.rss';
  var STORIES_TAG = 'from the community';
  var STORIES_HOME = 'https://omarchystories.org';
  var ITUNES_NS = 'http://www.itunes.com/dtds/podcast-1.0.dtd';
  var BAR_COUNT = 56;
  var STATS_INTERVAL = 30000;
  var CANVAS_W = 1180;
  var CANVAS_H = 880;
  var STORE_KEY = 'omarchy-radio-skin';
  var STORE_TRACKS = 'omarchy-radio-playlist';
  var STORE_STORIES = 'omarchy-radio-stories';

  var SKINS = [
    { name: 'green',            bg: '#0a0b0a', fg: '#e7e6e0', ac: '#5ef2a0', bd: '#23261f' },
    { name: 'daylight',         bg: '#f7f6f2', fg: '#23231f', ac: '#2f9e63', bd: '#dedbd2' },
    { name: 'catppuccin',       bg: '#1e1e2e', fg: '#cdd6f4', ac: '#89b4fa', bd: '#45475a' },
    { name: 'catppuccin latte', bg: '#eff1f5', fg: '#4c4f69', ac: '#1e66f5', bd: '#ccd0da' },
    { name: 'ethereal',         bg: '#060b1e', fg: '#ffcead', ac: '#7d82d9', bd: '#252e56' },
    { name: 'everforest',       bg: '#2d353b', fg: '#d3c6aa', ac: '#7fbbb3', bd: '#3d484d' },
    { name: 'flexoki light',    bg: '#fffcf0', fg: '#100f0f', ac: '#205ea6', bd: '#cecdc3' },
    { name: 'gruvbox',          bg: '#282828', fg: '#d4be98', ac: '#7daea3', bd: '#504945' },
    { name: 'hackerman',        bg: '#0b0c16', fg: '#ddf7ff', ac: '#82fb9c', bd: '#1f253a' },
    { name: 'kanagawa',         bg: '#1f1f28', fg: '#dcd7ba', ac: '#dcd7ba', bd: '#363646' },
    { name: 'last horizon',     bg: '#0c0b0c', fg: '#e2dddc', ac: '#b59790', bd: '#584e51' },
    { name: 'lumon',            bg: '#16242d', fg: '#f2fcff', ac: '#8bc9eb', bd: '#243d56' },
    { name: 'lupine',           bg: '#fafafa', fg: '#000000', ac: '#3264eb', bd: '#d0d0d0' },
    { name: 'matte black',      bg: '#121212', fg: '#bebebe', ac: '#e68e0d', bd: '#2a2a2a' },
    { name: 'miasma',           bg: '#222222', fg: '#c2c2b0', ac: '#78824b', bd: '#383838' },
    { name: 'nord',             bg: '#2e3440', fg: '#d8dee9', ac: '#81a1c1', bd: '#434c5e' },
    { name: 'osaka jade',       bg: '#111c18', fg: '#f7e8b2', ac: '#509475', bd: '#32473b' },
    { name: 'retro 82',         bg: '#05182e', fg: '#f6dcac', ac: '#faa968', bd: '#134e5a' },
    { name: 'ristretto',        bg: '#2c2525', fg: '#e6d9db', ac: '#f38d70', bd: '#403e41' },
    { name: 'rose pine',        bg: '#faf4ed', fg: '#575279', ac: '#56949f', bd: '#dfdad9' },
    { name: 'solitude',         bg: '#101315', fg: '#a5aeb4', ac: '#798186', bd: '#343d41' },
    { name: 'tokyo night',      bg: '#1a1b26', fg: '#c0caf5', ac: '#7aa2f7', bd: '#292e42' },
    { name: 'vantablack',       bg: '#000000', fg: '#ffffff', ac: '#8d8d8d', bd: '#1a1a1a' },
    { name: 'white',            bg: '#ffffff', fg: '#000000', ac: '#6e6e6e', bd: '#c0c0c0' }
  ];

  var STATIONS = [
    { slug: 'omarchy',     name: 'Omarchy',           tag: 'the house station' }
  ];

  var $ = function (id) { return document.getElementById(id); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── colour maths (mirrors the design's mix/lum) ─────── */

  function mix(a, b, t) {
    var pa = [1, 3, 5].map(function (i) { return parseInt(a.slice(i, i + 2), 16); });
    var pb = [1, 3, 5].map(function (i) { return parseInt(b.slice(i, i + 2), 16); });
    return '#' + pa.map(function (v, i) {
      return Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0');
    }).join('');
  }

  function lum(hex) {
    var p = [1, 3, 5].map(function (i) { return parseInt(hex.slice(i, i + 2), 16) / 255; });
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  }

  function theme(i) {
    var t = SKINS[i] || SKINS[0];
    var bg = t.bg, fg = t.fg, ac = t.ac, bd = t.bd;
    var light = lum(bg) > 0.5;
    var deep = light ? '#ffffff' : '#000000';
    var lcd = mix(bg, deep, light ? 0.55 : 0.5);
    return {
      name: t.name, bg: bg, fg: fg, ac: ac, bd: bd,
      bdF: mix(bd, bg, 0.55),
      c2: mix(fg, bg, 0.48),
      c3: mix(fg, bg, 0.7),
      rowOn: mix(ac, bg, 0.88),
      rowHov: mix(fg, bg, 0.93),
      trk: mix(fg, bg, 0.85),
      lcd: lcd,
      acFg: lum(ac) > 0.55 ? mix(bg, '#000000', 0.35) : '#ffffff',
      acHi: mix(ac, light ? '#000000' : '#ffffff', 0.3),
      g1: mix(ac, lcd, 0.45),
      g2: mix(ac, lcd, 0.62),
      light: light
    };
  }

  /* ── formatting ──────────────────────────────────────── */

  function fmt(s) {
    if (!s || !isFinite(s)) return '00:00';
    var m = Math.floor(s / 60), r = Math.floor(s % 60);
    return String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* Spelled out here rather than by locale: the deck is one typeface at one
     size, and an engine that renders September as "Sept" makes the list ragged
     on some machines and not others. */
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function dateLabel(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  // An episode is an hour, not three minutes: minutes are the useful unit,
  // and the clock in the deck still counts the seconds.
  function lengthLabel(secs) {
    if (!secs) return '';
    var m = Math.round(secs / 60);
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  function num(n) {
    if (n == null) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(Math.round(n));
  }

  /* ── state ───────────────────────────────────────────── */

  var S = {
    st: 0,
    mode: 'radio', // 'radio' | 'track' | 'story'
    ti: -1,        // index into whichever list the mode names
    tracks: [],
    eps: [],
    show: null,    // what the feed says the show is called, and where it lives
    tab: 'songs',  // which of the two lists the panel is showing
    route: '',     // the list the address is naming while nothing is playing
    epOpen: true,  // the playing episode is showing what it is about
    feedErr: false,
    playing: false,
    vol: 0.8,
    cur: 0,
    dur: 0,
    skin: 0,
    themeOpen: false,
    lyricsOpen: false,
    status: 'ready',
    stats: null,
    icyTitle: '',
    icyName: '',
    icyGenre: '',
    fit: 1
  };

  try {
    var saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      var si = SKINS.findIndex(function (k) { return k.name === saved; });
      if (si >= 0) S.skin = si;
    }
  } catch (e) { /* private mode */ }

  var lev = new Float32Array(BAR_COUNT);
  var amp = 0;
  var simVis = true;
  var audio, music, pod, ctx, analyser, freq, metaAbort, dpr = 1;
  var loadedSrc = '';
  var intent = 'idle'; // 'play' | 'pause' | 'stop' — what the listener last asked for
  var gestured = false; // the listener has touched the page at least once
  var wiring = false; // an audio graph waiting on its context to start
  var armed = null; // an autoplay the browser refused, waiting for a gesture
  var linkPending = false; // a link named a track; the lists decide which
  var loadsLeft = SHOW_PODCAST ? 2 : 1; // a link waits on the lists there are
  var keptTracks = false; // the playlist on screen is the copy from last visit
  var sheets = {}; // key -> parsed sheet, or why there is not one
  var lyricsKey = ''; // whose sheet the lyrics box is holding
  // The stamped sheet being followed, wherever it lives: the lyrics box for a
  // song, the open episode inside the podcast list for a chapter list.
  var sheetOn = { lines: null, node: null, scroll: null };
  var lyricsLine = -1; // the line the audio is on
  var handScrolled = 0, autoScrolled = 0; // who moved the sheet last, and when
  var retryN = 0, retryTimer = null, lastProgress = 0;

  var el = {};
  // The state cell of the row that is playing. Held so pressing pause can say
  // so in the list without rebuilding it: the list is also what the listener
  // is reading, and a rebuild throws away their scroll position.
  var stateCell = null;

  /* ── theme application ───────────────────────────────── */

  function applyTheme() {
    var k = theme(S.skin);
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
    r.setProperty('--scan', 'repeating-linear-gradient(180deg, ' +
      (k.light ? 'rgba(0,0,0,.055) 0 1px, transparent 1px 4px'
               : 'rgba(0,0,0,.42) 0 2px, transparent 2px 4px') + ')');

    el.skinName.textContent = k.name;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', k.bg);

    Array.prototype.forEach.call(el.themeMenu.children, function (li, i) {
      li.classList.toggle('is-on', i === S.skin);
      li.querySelector('button').setAttribute('aria-selected', i === S.skin ? 'true' : 'false');
    });

    try { localStorage.setItem(STORE_KEY, k.name); } catch (e) { /* private mode */ }
  }

  function buildThemeMenu() {
    var frag = document.createDocumentFragment();
    SKINS.forEach(function (d, i) {
      var li = document.createElement('li');
      li.setAttribute('role', 'none');
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.innerHTML =
        '<span class="sw" aria-hidden="true">' +
          '<span style="background:' + d.bg + '"></span>' +
          '<span style="background:' + d.ac + '"></span>' +
          '<span style="background:' + d.fg + '"></span>' +
        '</span><span class="menu-name"></span>';
      b.querySelector('.menu-name').textContent = d.name;
      b.addEventListener('click', function () {
        S.skin = i;
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
    el.themeCaret.textContent = '▲';
  }

  function closeThemes() {
    S.themeOpen = false;
    el.themeMenu.hidden = true;
    el.themeBtn.setAttribute('aria-expanded', 'false');
    el.themeCaret.textContent = '▼';
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

  var installEvent = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function wireInstall() {
    // Already an app: nothing to offer.
    if (isStandalone()) return;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      installEvent = e;
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

    // navigator.standalone exists only on iOS Safari, and is false there
    // until the page is launched from the home screen.
    if (window.navigator.standalone === false) el.installBtn.hidden = false;
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

  function setMediaMeta(title, artist) {
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
    function on(action, fn) {
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
     A live stream drops for ordinary reasons: a flaky link, a laptop
     waking, the server cycling. The element reports that as 'error', as a
     bare 'ended', or sometimes as nothing at all, which is what the
     watchdog below is for. Retry only while the listener still wants
     sound, back off so a server that is down is not hammered, and say so
     rather than going quiet when the attempts run out. */

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
      setStatus(S.mode === 'radio'
        ? 'stream unreachable — press play'
        : 'that one would not play');
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
     allowed to read: the songs are served from this origin and the stream
     sends the header, so those run through the graph and drive a real
     spectrum. An episode comes from the show's host, whose download link
     redirects through an address that sends no such header, and a source the
     graph is not allowed to read is silence rather than an error. So episodes
     play on an element the graph never touches, and the bars simulate while
     one does — the same stand-in used before the first gesture.

     Every handler asks first whether it is still the element in use, because
     switching pauses the other one and a pause fires an event either way. */
  function makeAudio(analysed) {
    var a = new Audio();
    a.preload = 'none';
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
    a.addEventListener('ended', function () {
      if (!mine()) return;
      // A live stream has no end; reaching one means the connection went.
      if (S.mode === 'radio') scheduleReconnect();
      else next();
    });
    a.addEventListener('playing', function () {
      if (!mine()) return;
      cancelReconnect();
      armed = null; // whatever was owed, it is playing now
      lastProgress = Date.now();
      S.playing = true;
      setStatus(S.mode === 'radio' ? 'streaming live' : 'playing');
      paintTransport();
    });
    a.addEventListener('pause', function () {
      if (!mine()) return;
      // pause fires asynchronously, after stop() has already set its status.
      // Only a deliberate pause calls off a reconnect; a dropped stream also
      // pauses the element, and there intent is still 'play'.
      if (intent === 'pause' || intent === 'stop') { cancelReconnect(); stopMeta(); armed = null; }
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
  function useElement(a) {
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
  function volumeIsSettable() {
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
      var C = window.AudioContext || window.webkitAudioContext;
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
  // the first of them. 'radio' names no list and no item.
  function playingList() {
    if (S.mode === 'track') return S.tracks;
    if (S.mode === 'story') return S.eps;
    return null;
  }

  function onScreenList() { return S.tab === 'stories' ? S.eps : S.tracks; }

  function nowItem() {
    var l = playingList();
    return l ? l[S.ti] : null;
  }

  function wantedSrc() {
    var it = nowItem();
    if (it) return it.url;
    return HOST + '/' + STATIONS[S.st].slug + '/stream';
  }

  function play(src, mode, ti) {
    intent = 'play';
    loadedSrc = src;
    useElement(mode === 'story' ? pod : music);
    wireGraph();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    audio.src = src;
    audio.load();
    var p = audio.play();
    // NotAllowedError is the autoplay block, the only rejection the listener
    // can actually act on. AbortError just means a later pause/load
    // superseded this call, and a source that will not load rejects here
    // too, where the reconnect path is the one that should speak.
    if (p && p.catch) p.catch(function (err) {
      if (err && err.name === 'NotAllowedError') arm(src, mode, ti);
    });
    S.mode = mode;
    S.ti = ti;
    S.cur = 0;
    S.dur = 0;
    lastProgress = Date.now();
    setStatus('connecting…');
    paintAll();
  }

  function playRadio(how) {
    play(HOST + '/' + STATIONS[S.st].slug + '/stream', 'radio', -1);
    syncRoute(how);
    startMeta();
  }

  /* An item on demand carries its own title, so the live feed's metadata is
     not needed while one plays. */
  function playFrom(list, mode, i, how) {
    var it = list[i];
    if (!it) return;
    play(it.url, mode, i);
    syncRoute(how);
    stopMeta();
  }

  function playTrack(i, how) {
    S.tab = 'songs';
    S.route = 'playlist';
    playFrom(S.tracks, 'track', i, how);
  }

  function playStory(i, how) {
    S.tab = 'stories';
    S.route = 'podcast';
    S.epOpen = true; // an episode just chosen shows what it is
    playFrom(S.eps, 'story', i, how);
  }

  function toggle() {
    if (!audio.paused) { intent = 'pause'; cancelReconnect(); audio.pause(); return; }
    intent = 'play';
    var want = wantedSrc();
    // Nothing loaded yet, or the station changed while stopped: connect fresh.
    if (loadedSrc !== want) { play(want, S.mode, S.ti); return; }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
    if (S.mode === 'radio') startMeta();
  }

  function stop() {
    intent = 'stop';
    cancelReconnect();
    stopMeta();
    // Pressing stop on an autoplay that never got permission still means no.
    armed = null;
    S.icyTitle = '';
    audio.pause();
    try { audio.currentTime = 0; } catch (e) { /* live stream */ }
    loadedSrc = '';
    S.playing = false;
    S.cur = 0;
    setStatus('stopped');
    paintAll();
  }

  // There is one station, so these only ever step whichever list is playing.
  function next() {
    var l = playingList();
    if (l && l.length) playFrom(l, S.mode, (S.ti + 1) % l.length);
  }

  function prev() {
    var l = playingList();
    if (l && l.length) playFrom(l, S.mode, (S.ti - 1 + l.length) % l.length);
  }

  /* ── autoplay ────────────────────────────────────────
     Joining the site is the tune-in: the deck should already be playing by
     the time it has finished drawing. Browsers only grant an audible
     autoplay to a site the listener has engaged with before, so a first
     visit is refused outright. Rather than leave them looking at a dead
     deck, remember what was owed and spend their next gesture on it,
     wherever on the page it lands. */

  function arm(src, mode, ti) {
    armed = { src: src, mode: mode, ti: ti };
    // playRadio() opened the metadata connection on the way in, and that is a
    // full stream the server counts as a listener. Nobody is listening yet.
    stopMeta();
    setStatus(window.matchMedia('(pointer: coarse)').matches
      ? 'tap anywhere to start'
      : 'click anywhere to start');
  }

  // A gesture that belongs to something else: a control whose own handler is
  // about to run, the space binding, or a combination the browser will not
  // count as engagement anyway.
  function spokenFor(e) {
    if (e.type === 'keydown') {
      return e.code === 'Space' || e.ctrlKey || e.metaKey || e.altKey || e.key === 'Escape';
    }
    return !!(e.target && e.target.closest && e.target.closest('button, a, [role="slider"]'));
  }

  function firstGesture(e) {
    if (!gestured) {
      gestured = true;
      // Also the first chance at a real spectrum: the audio graph needs a
      // context that is allowed to run, and this gesture is what buys one.
      wireGraph();
    }
    if (!armed || spokenFor(e)) return;
    var owed = armed;
    armed = null;
    if (intent === 'pause' || intent === 'stop') return; // they already said no
    play(owed.src, owed.mode, owed.ti);
    if (owed.mode === 'radio') startMeta();
  }

  function wireGestures() {
    // Capture, so this runs before a control's own handler decides the
    // gesture was meant for it.
    ['pointerdown', 'touchstart', 'keydown'].forEach(function (t) {
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
     very page by tools/build-routes.py, then — for a link the pages here do
     not know, which is how a brand new episode arrives — the lists as they
     load, in listSettled(). The live stream has nothing to look up either
     way, and is the answer when nothing else is. */
  function tuneIn() {
    var r = here();
    if (!r.known || !r.kind) { playRadio('replace'); return; }
    S.route = r.kind;

    // A list, rather than something in one: read it while the stream plays.
    if (!r.slug) { setTab(LISTS[r.kind].tab); playRadio('replace'); return; }

    restoreList(r.kind);
    if (navigate(r, 'replace')) return;
    if (seedRoute(r) && navigate(r, 'replace')) return;
    linkPending = true;
  }

  // What was kept from the last visit. The whole list, so it goes on screen
  // in full rather than as the one row a link named.
  function restoreList(kind) {
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
  function seedRoute(r) {
    var raw = window.__ITEM__;
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

  /* ── network ─────────────────────────────────────────── */

  function stopMeta() {
    if (metaAbort) { metaAbort.abort(); metaAbort = null; }
  }

  /* Reads the ICY title off the live stream. This is a full stream
     connection whose audio is thrown away, so it runs only while the
     listener is actually on the live stream. Left running from page load
     it downloaded the station around the clock for every open tab, and
     the server counted each one as a listener. */
  function startMeta() {
    if (metaAbort) metaAbort.abort();
    if (S.mode !== 'radio') { metaAbort = null; return; }
    var ac = new AbortController();
    metaAbort = ac;
    var url = HOST + '/' + STATIONS[S.st].slug + '/stream';

    fetch(url, { headers: { 'Icy-MetaData': '1' }, signal: ac.signal }).then(function (r) {
      var g = function (k) { return r.headers.get(k); };
      S.icyName = g('icy-name') || '';
      S.icyGenre = g('icy-genre') || '';
      paintLcd();

      var metaint = parseInt(g('icy-metaint') || '0', 10);
      if (!metaint || !r.body) return;

      var reader = r.body.getReader();
      var dec = new TextDecoder('utf-8');
      var skip = metaint, want = 0, len = -1, meta = [];

      function pump() {
        return reader.read().then(function (res) {
          if (res.done || ac.signal.aborted) return;
          var value = res.value;
          var i = 0;
          while (i < value.length) {
            if (skip > 0) {
              var take = Math.min(skip, value.length - i);
              skip -= take; i += take;
              continue;
            }
            if (len < 0) {
              len = value[i++] * 16;
              want = len;
              meta = [];
              if (len === 0) { skip = metaint; len = -1; }
              continue;
            }
            var t2 = Math.min(want, value.length - i);
            for (var k = 0; k < t2; k++) meta.push(value[i + k]);
            i += t2; want -= t2;
            if (want === 0) {
              var s = dec.decode(new Uint8Array(meta));
              var m = s.match(/StreamTitle='([^']*)'/);
              if (m && m[1] !== S.icyTitle) { S.icyTitle = m[1]; paintLcd(); }
              skip = metaint; len = -1;
            }
          }
          return pump();
        });
      }
      return pump();
    }).catch(function () { /* metadata is best-effort */ });
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

  function xmlKid(node, name) {
    for (var i = 0; i < node.children.length; i++) {
      if (node.children[i].tagName === name) return node.children[i];
    }
    return null;
  }

  function xmlText(node, name) {
    var n = xmlKid(node, name);
    return n ? (n.textContent || '').trim() : '';
  }

  function itunesText(node, name) {
    var n = node.getElementsByTagNameNS(ITUNES_NS, name)[0];
    return n ? (n.textContent || '').trim() : '';
  }

  // itunes:duration comes as seconds, mm:ss or hh:mm:ss.
  function hms(raw) {
    if (!raw) return 0;
    var parts = String(raw).split(':');
    var out = 0;
    for (var i = 0; i < parts.length; i++) {
      var n = parseInt(parts[i], 10);
      if (isNaN(n)) return 0;
      out = out * 60 + n;
    }
    return out;
  }

  /* The description arrives as the markup the show wrote it in. Blocks become
     lines, a list item keeps a bullet so the takeaways do not run together,
     and a link that is not already its own address says where it goes,
     because a line in this panel is text and cannot be clicked.

     Anything stamped with a time is a chapter rather than a note, wherever in
     the description it sits, and once the stamps are lifted out the heading
     above them has nothing left to head, so it goes too. */
  function notesOf(markup) {
    var lines = [], chapters = [];
    if (!markup) return { lines: lines, chapters: chapters };

    var body = new DOMParser().parseFromString(markup, 'text/html').body;

    Array.prototype.forEach.call(body.querySelectorAll('a[href]'), function (a) {
      var txt = (a.textContent || '').trim();
      var href = a.getAttribute('href') || '';
      if (!href) return;
      if (!txt) a.textContent = href;
      else if (txt !== href && !/^https?:\/\//i.test(txt)) {
        a.textContent = txt + ' (' + href + ')';
      }
    });

    var blocks = body.querySelectorAll(BLOCKS);
    var raw = blocks.length
      ? Array.prototype.map.call(blocks, function (node) {
          // A block holding another block is a wrapper; the inner ones speak.
          if (node.querySelector(BLOCKS)) return '';
          var txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!txt) return '';
          return node.tagName === 'LI' ? '· ' + txt : txt;
        })
      // A description that is only text still has its own lines.
      : (body.textContent || '').split(/\n+/);

    Array.prototype.forEach.call(raw, function (line) {
      line = String(line).trim();
      if (!line) return;
      var m = CHAPTER_LINE.exec(line.replace(/^· /, ''));
      if (m) {
        chapters.push({
          t: (m[1] ? parseInt(m[1], 10) * 3600 : 0) +
            parseInt(m[2], 10) * 60 + parseInt(m[3], 10),
          txt: m[4].trim()
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

  function parseFeed(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('not a feed');
    var ch = doc.getElementsByTagName('channel')[0];
    if (!ch) throw new Error('not a feed');

    var show = xmlText(ch, 'title') || 'Omarchy Stories';
    var eps = [];
    var items = ch.getElementsByTagName('item');

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var enc = xmlKid(it, 'enclosure');
      var url = enc ? enc.getAttribute('url') : '';
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
      });
    }

    // Newest first, the way a show is read. The list numbers them from the
    // other end, so episode 01 stays episode 01 as the show grows.
    eps.sort(function (a, b) { return b.ms - a.ms; });

    return { show: show, link: xmlText(ch, 'link') || STORIES_HOME, episodes: eps };
  }

  function applyFeed(f) {
    S.show = { name: f.show, link: f.link };
    S.eps = f.episodes || [];
    assignSlugs(S.eps, 'podcast');
    if (S.tab === 'stories') paintTracks();
  }

  function readStories() {
    try { return JSON.parse(localStorage.getItem(STORE_STORIES)); } catch (e) { return null; }
  }

  function saveStories(f) {
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

  function epNumber(i) { return S.eps.length - i; }

  function loadStats() {
    fetch(HOST + '/statistics').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.stations) {
        S.stats = j;
        paintStats();
        paintHeader();
      }
    }).catch(function () { /* stats optional */ });
  }

  function applyManifest(j) {
    S.tracks = ((j && j.tracks) || []).map(resolveTrack);
    assignSlugs(S.tracks, 'playlist');
    paintTracks();
  }

  function readManifest() {
    try { return JSON.parse(localStorage.getItem(STORE_TRACKS)); } catch (e) { return null; }
  }

  function saveManifest(j) {
    try { localStorage.setItem(STORE_TRACKS, JSON.stringify(j)); } catch (e) { /* private mode */ }
  }

  /* A link that names a song or an episode has to wait for the list it is in,
     and the two lists arrive separately. Whichever one answers gets its
     chance at the link; the live stream is the fallback only once neither of
     them turned out to have it. */
  function listSettled() {
    loadsLeft--;
    if (!linkPending) return;
    if (navigate(here(), 'replace')) { linkPending = false; return; }
    if (loadsLeft <= 0) {
      // Neither list had it: a renamed track, a typo, or an episode the show
      // published since the copy of the feed here was mirrored. The stream is
      // never the wrong answer, and the address stops claiming otherwise.
      linkPending = false;
      S.route = '';
      playRadio('replace');
    }
  }

  function loadTracks() {
    fetch(TRACKS_MANIFEST).then(function (r) {
      if (!r.ok) throw new Error('no playlist');
      return r.json();
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

      // The kept copy picked the track; the real playlist gets the last word
      // on where it sits, and on whether it is still there at all.
      if (open) {
        var i = indexOfKey(S.tracks, open);
        if (i < 0) { playRadio('replace'); return; }
        if (i !== S.ti) { S.ti = i; paintAll(); }
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
  function resolveTrack(t) {
    if (t.url) return t;
    var r = {};
    for (var k in t) {
      if (Object.prototype.hasOwnProperty.call(t, k)) r[k] = t[k];
    }
    r.url = TRACKS_DIR + encodeURIComponent(t.file || '');
    return r;
  }

  /* ── painting ────────────────────────────────────────── */

  function setStatus(s) {
    S.status = s;
    el.status.textContent = s;
  }

  function paintHeader() {
    var ss = S.stats && S.stats.stations ? S.stats.stations[STATIONS[S.st].slug] : null;
    var netActive = S.stats && S.stats.stations
      ? Object.keys(S.stats.stations).reduce(function (a, k) {
          return a + (S.stats.stations[k].active_listeners || 0);
        }, 0)
      : null;
    el.netActive.textContent = ss ? ss.active_listeners : (netActive == null ? '—' : netActive);
    el.netSessions.textContent = ss ? num(ss.total_sessions) : '—';
    el.netHours.textContent = ss ? num(ss.total_listen_hours) : '—';
  }

  function showName() { return (S.show && S.show.name) || 'Omarchy Stories'; }
  function showLink() { return (S.show && S.show.link) || STORIES_HOME; }

  function paintLcd() {
    var cur = STATIONS[S.st];
    var it = nowItem();
    var story = S.mode === 'story' ? it : null;
    var t = S.mode === 'track' ? it : null;
    var live = S.mode === 'radio';

    el.stationLabel.textContent = story
      ? showName().toLowerCase() + ' · ' + STORIES_TAG
      : cur.name.toLowerCase() + ' · ' + cur.tag;
    el.srcLabel.textContent = live
      ? '◉ live stream'
      : story
        ? 'podcast · episode ' + epNumber(S.ti)
        : 'playlist · track ' + (S.ti + 1);

    // Filled while the live stream is the source, dot blinking only when
    // it is actually playing rather than merely selected.
    el.backToRadio.classList.toggle('is-live', live);
    el.backToRadio.classList.toggle('is-onair', live && S.playing);

    var marquee = it
      ? (it.title + '  —  ' + it.artist)
      : (S.icyTitle ? S.icyTitle : (S.icyName || cur.name) + '  —  ' + cur.tag);
    Array.prototype.forEach.call(el.marq.children, function (n) { n.textContent = marquee; });

    setMediaMeta(
      it ? it.title : (S.icyTitle || S.icyName || cur.name),
      it ? it.artist : (S.icyTitle ? (S.icyName || cur.name) : cur.tag)
    );

    el.artist.textContent = story
      ? [showName(), dateLabel(story.ms), lengthLabel(story.secs)]
          .filter(Boolean).join(' · ')
      : t
        ? (t.album || t.artist)
        : [S.icyName || cur.name, S.icyGenre, S.icyTitle ? 'on air now' : 'continuous rotation']
            .filter(Boolean).join(' · ');

    /* The tab names the address, the way the title the page was served with
       does — a song's page still reads as the song while it is paused, which
       is how a listener finds it again among twenty tabs. The live stream has
       no page of its own, so there it names whatever is on air. */
    document.title = story
      ? story.title + ' · ' + showName()
      : t
        ? t.title + ' by ' + t.artist + ' · Omarchy Radio'
        : (S.playing ? marquee.replace(/\s+/g, ' ').trim() + ' · ' : '') + 'Omarchy Radio';

    paintClock();
  }

  function paintClock() {
    var live = S.mode === 'radio';
    el.curTime.textContent = live && S.playing ? '∞' : fmt(S.cur);
    el.durTime.textContent = live ? 'live' : fmt(S.dur);
    var pct = (live || !S.dur) ? 0 : Math.min(100, (S.cur / S.dur) * 100);
    el.seekFill.style.width = pct.toFixed(2) + '%';
    el.seekHead.style.left = pct.toFixed(2) + '%';
    el.seek.setAttribute('aria-valuenow', Math.round(pct));
  }

  function paintTransport() {
    setMediaState();
    if (stateCell) stateCell.textContent = S.playing ? 'playing' : 'paused';
    el.playGlyph.textContent = S.playing ? '❙❙' : '▶';
    el.toggle.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    el.volRot.style.transform = 'rotate(' + (-135 + S.vol * 270) + 'deg)';
    el.volLabel.textContent = Math.round(S.vol * 100);
    el.volKnob.setAttribute('aria-valuenow', Math.round(S.vol * 100));

    // 0..1 position for the phone layout, where the dial is a bar.
    el.volKnob.style.setProperty('--v', S.vol.toFixed(4));

    // Nothing to scrub on a live stream.
    el.seek.classList.toggle('is-live', S.mode === 'radio');
  }

  function paintStats() {
    var ss = S.stats && S.stats.stations ? S.stats.stations[STATIONS[S.st].slug] : null;
    el.tileActive.textContent = ss ? ss.active_listeners : '—';
    el.tilePeak.textContent = ss ? ss.peak_listeners : '—';
    el.tileSessions.textContent = ss ? num(ss.total_sessions) : '—';
    el.tileHours.textContent = ss ? num(ss.total_listen_hours) : '—';
    el.peak.textContent = ss ? ss.peak_listeners : '—';
    paintGeo(ss);
  }

  function paintGeo(ss) {
    var top = ((ss && ss.top_countries) || []).slice(0, 6);
    var max = top.reduce(function (a, g) { return Math.max(a, g.sessions || 0); }, 0) || 1;
    el.geoList.innerHTML = '';
    var frag = document.createDocumentFragment();
    top.forEach(function (g) {
      var li = document.createElement('li');
      li.className = 'geo-row';
      li.innerHTML =
        '<div class="geo-top"><span class="geo-name"></span><span class="geo-val"></span></div>' +
        '<div class="geo-bar"><span></span></div>';
      li.querySelector('.geo-name').textContent = g.country + ' · ' + g.country_code;
      li.querySelector('.geo-val').textContent = num(g.sessions);
      li.querySelector('.geo-bar span').style.width = ((g.sessions / max) * 100).toFixed(1) + '%';
      frag.appendChild(li);
    });
    el.geoList.appendChild(frag);
  }

  /* ── routing ────────────────────────────────────
     The address is the state. Two lists, each with a path of its own:

       /                      the live stream
       /playlist              the songs
       /playlist/<song>       that song, playing
       /podcast               the episodes
       /podcast/<episode>     that episode, playing

     Those are real pages. tools/build-routes.py writes one per item, so a
     link that is shared arrives as a document of its own: the song's name in
     the tab, its own card where it is pasted, and the item itself baked into
     the page so the sound can start before anything is fetched.

     From there it is one deck. Pressing a row swaps the audio and rewrites
     the address, and nothing reloads — which is what keeps following a link
     from costing the listener whatever they were already hearing.

     Everything the deck does to the address goes through syncRoute().
     Everything the listener does to it — a link, the back button, a path
     typed by hand — comes back in through navigate(). */

  var LISTS = {
    playlist: { tab: 'songs',   mode: 'track', list: function () { return S.tracks; } },
    podcast:  { tab: 'stories', mode: 'story', list: function () { return S.eps; } }
  };

  function slugify(str) {
    var s = String(str || '');
    // Strip accents first, or "Aurelien" would come out full of dashes.
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.toLowerCase()
      .replace(/['\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Slugs come from the title so a link reads as the song. Two tracks can
  // share a title, so the artist breaks the tie, and a number after that.
  // The key is the path: the songs have one namespace, the episodes another,
  // and neither can shadow the other.
  //
  // A bare {} would inherit "constructor" and the rest from Object, so a song
  // by that name would read as a clash with something that is not there. The
  // slugs also have to agree with tools/build-routes.py, which computes them
  // again for the pages it writes; tools/test-routes.py checks that the two
  // implementations still say the same thing.
  function assignSlugs(items, kind) {
    var seen = Object.create(null);
    items.forEach(function (t) {
      var base = slugify(t.title) || 'track';
      var slug = base;
      if (seen[slug]) slug = base + '-' + slugify(t.artist);
      var n = 2;
      while (seen[slug]) { slug = base + '-' + n; n++; }
      seen[slug] = true;
      t.slug = slug;
      t.kind = kind;
      t.key = kind + '/' + slug;
    });
  }

  function indexOfKey(list, key) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) return i;
    }
    return -1;
  }

  function permalink(t) { return location.origin + '/' + t.key; }

  /* Tolerant on the way in, exact on the way out. A trailing slash, the
     .html of the file that served the page, a capital letter, an escaped
     character: all of them name the same route, and the deck then writes the
     one spelling worth sharing.

     An address this deck does not own is reported as such rather than guessed
     at, so a link to a track file or to the feed is left to the browser. */
  function parseRoute(pathname, hash) {
    var p = String(pathname || '/');
    try { p = decodeURIComponent(p); } catch (e) { /* leave it as typed */ }
    p = p.toLowerCase()
      .replace(/\/index\.html?$/, '/')
      .replace(/\.html?$/, '')
      .replace(/\/+$/, '');
    var seg = p.split('/').filter(Boolean);

    if (!seg.length) return fromHash(hash);
    if (!LISTS[seg[0]] || seg.length > 2) return stray();
    return route(seg[0], seg.length > 1 ? seg[1] : '', false);
  }

  /* The links from before there were paths: /#song, and /#stories/episode.
     The slug is the part worth keeping, so they resolve here and the address
     is rewritten to the page that now holds them. */
  function fromHash(hash) {
    var h = String(hash || '').replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (e) { /* as typed */ }
    h = h.toLowerCase();
    if (!h) return route('', '', false);
    var m = /^(stories|podcast|playlist)\/(.+)$/.exec(h);
    if (m) return route(m[1] === 'playlist' ? 'playlist' : 'podcast', m[2], true);
    if (/^[a-z0-9][a-z0-9-]*$/.test(h)) return route('playlist', h, true);
    return route('', '', false); // a fragment that names no track: it is home
  }

  function route(kind, slug, legacy) {
    return {
      kind: kind,
      slug: String(slug || '').replace(/[^a-z0-9-]/g, ''),
      known: true,
      legacy: !!legacy
    };
  }

  function stray() { return { kind: '', slug: '', known: false, legacy: false }; }

  function here() { return parseRoute(location.pathname, location.hash); }

  /* The path for what the deck is showing: the item playing, if the panel is
     showing the list it came out of, and otherwise the list being read. Home
     is the live stream, which is where a visit that named nothing starts. */
  function wantedPath() {
    var it = nowItem();
    var showing = S.tab === 'stories' ? 'podcast' : 'playlist';
    if (it && it.kind === showing) return '/' + it.key;
    return S.route ? '/' + S.route : '/';
  }

  /* Pressing a row is a navigation and earns a history entry: back returns
     the listener where they came from, the way a link should. Stepping with
     the transport buttons, or a track ending into the next one, does not —
     that would bury the way out under a playlist's worth of entries. */
  function syncRoute(how) {
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
  function navigate(r, how) {
    if (!r.known) return false;

    if (!r.kind) {
      // Home is the front of the deck: the live stream, and the songs.
      S.route = '';
      setTab('songs');
      playRadio(how); // which repaints, the tabs and the list with it
      return true;
    }

    var spec = LISTS[r.kind];
    if (!r.slug) { showTab(spec.tab, how); return true; }

    var i = indexOfKey(spec.list(), r.kind + '/' + r.slug);
    if (i < 0) return false;

    /* Already the one playing: the back button landing on what is in the
       room, or a second press on the row that is going. Show it, do not
       start it again — twenty minutes into an episode, that is the whole
       difference between following a link and losing your place. */
    if (S.mode === spec.mode && S.ti === i) {
      if (S.tab !== spec.tab) showTab(spec.tab, 'replace');
      else syncRoute(how);
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
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;

      var u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
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

  function copyLink(t) {
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
      : STATIONS[S.st].name.toLowerCase();
    el.tracks.setAttribute('aria-label', stories ? 'Episodes' : 'Playlist');
  }

  function setTab(tab) {
    if (S.tab === tab) return false;
    S.tab = tab;
    // The sheet was opened on the other list's item; it does not follow.
    S.lyricsOpen = false;
    lyricsLine = -1;
    el.tracks.scrollTop = 0;
    return true;
  }

  function setCurrent(a, on) {
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }

  function showTab(tab, how) {
    if (tab === 'stories' && !SHOW_PODCAST) return;
    S.route = tab === 'stories' ? 'podcast' : 'playlist';
    if (setTab(tab)) paintAll();
    syncRoute(how);
  }

  function paintTracks() {
    var list = onScreenList();
    var stories = S.tab === 'stories';
    paintTabs();
    stateCell = null;
    el.tracks.innerHTML = '';
    var frag = document.createDocumentFragment();
    list.forEach(function (tr, i) {
      var on = i === S.ti && S.mode === (stories ? 'story' : 'track');
      var li = document.createElement('li');
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
      b.querySelector('.tr-n').textContent =
        String(stories ? epNumber(i) : i + 1).padStart(2, '0');
      b.querySelector('.tr-title').textContent = tr.title;
      b.querySelector('.tr-ex').hidden = !tr.explicit;
      // An episode has no artist to name under the title: it has a date and
      // a length, which are the two things worth knowing before pressing it.
      b.querySelector('.tr-artist').textContent = stories
        ? [dateLabel(tr.ms), lengthLabel(tr.secs)].filter(Boolean).join(' · ')
        : tr.artist;
      var state = b.querySelector('.tr-st');
      state.textContent = on ? (S.playing ? 'playing' : 'paused') : '';
      if (on) stateCell = state;

      /* The episode playing is also the one whose row opens and closes. A
         second press on a song starts it again, which is what a three-minute
         song is for; a second press on the episode you are 20 minutes into
         must never mean that, so it works the panel instead. */
      var opens = stories && on;
      if (opens) {
        var caret = b.querySelector('.tr-c');
        caret.hidden = false;
        caret.textContent = S.epOpen ? '▾' : '▸';
        b.setAttribute('aria-expanded', S.epOpen ? 'true' : 'false');
      }
      b.addEventListener('click', function (ev) {
        // A modified press is the listener asking the browser for a tab of
        // its own, and the href is there so that they get one.
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        ev.preventDefault();
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
    if (!S.lyricsOpen) paintTrackNote();
  }

  function toggleEpisode() {
    S.epOpen = !S.epOpen;
    // The chapters go with the panel; nothing left on screen to follow.
    if (!S.epOpen) sheetOn = { lines: null, node: null, scroll: null };
    paintTracks();
  }

  function epHeading(text) {
    var h = document.createElement('p');
    h.className = 'ep-h';
    h.textContent = text;
    return h;
  }

  function episodeBody(ep) {
    var li = document.createElement('li');
    li.className = 'ep-open';

    var chapters = ep.chapters && ep.chapters.length;
    if (chapters) {
      li.appendChild(epHeading(plural(ep.chapters.length, 'chapter') + ' · press one to jump'));
      var ol = document.createElement('ol');
      ol.className = 'ep-chapters';
      // The same stamped sheet a lyric is, so it lights the chapter the
      // episode is in and can be pressed to get there.
      paintSheet({
        lines: ep.chapters.map(function (c) { return { t: c.t, txt: c.txt }; }),
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

    if (!chapters && !(ep.notes && ep.notes.length)) {
      li.appendChild(epHeading(ep.provisional
        ? 'reading the feed for what is in this one…'
        : 'the show sent no notes with this one'));
    }
    return li;
  }

  function paintTrackNote() {
    if (S.tab === 'stories') { paintStoryNote(); return; }
    el.playlistNote.textContent = S.tracks.length
      ? S.tracks.length + ' tracks on demand'
      : 'live rotation only — no track list on this stream';
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
     just a sheet, which is all most people will want to write. The live
     stream has neither, so the button is only there for a track. */

  function lyricsUrl(t) {
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
  function parseLyrics(text) {
    var lines = [];
    var timed = false;

    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line || /^\[[a-z]{2,}:/i.test(line)) return;

      var times = [];
      var txt = line.replace(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g, function (all, m, s) {
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

  function seekTo(t) {
    if (!nowItem()) return;
    try { audio.currentTime = t; } catch (e) { return; }
    S.cur = t;
    paintClock();
    // Pressing a chapter is asking to hear it, not to mark the place.
    if (audio.paused) toggle();
  }

  function loadLyrics(t) {
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

  function scrollToLine(node) {
    if (Date.now() - handScrolled < 6000) return;
    var box = sheetOn.scroll;
    var to = node.offsetTop - (box.clientHeight / 2) + (node.offsetHeight / 2);
    autoScrolled = Date.now();
    box.scrollTop = Math.max(0, to);
  }

  // Which line the audio is on: the last one that has started.
  function lineAt(lines, at) {
    var i = -1;
    for (var n = 0; n < lines.length; n++) {
      if (lines[n].t <= at) i = n; else break;
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

    var was = sheetOn.node.children[lyricsLine];
    if (was) { was.classList.remove('is-on'); was.removeAttribute('aria-current'); }

    lyricsLine = i;
    var now = sheetOn.node.children[i];
    if (!now) return;
    now.classList.add('is-on');
    now.setAttribute('aria-current', 'true');
    if (sheetOn.scroll) scrollToLine(now);
  }

  function paintSheet(sheet, node, scroll) {
    node.innerHTML = '';
    var frag = document.createDocumentFragment();
    sheet.lines.forEach(function (l) {
      var li = document.createElement('li');
      li.className = 'ly-line' + (sheet.jump ? ' ly-jump' : '');
      if (sheet.jump) {
        var b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span class="ly-t"></span><span class="ly-x"></span>';
        b.querySelector('.ly-t').textContent = fmt(l.t);
        b.querySelector('.ly-x').textContent = l.txt;
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
      ? S.tracks[S.ti]
      : null;

    // Nothing to show for the live stream, and nothing to offer either.
    if (!t) {
      S.lyricsOpen = false;
      el.lyricsBtn.hidden = true;
    } else {
      el.lyricsBtn.hidden = false;
      el.lyricsBtn.classList.toggle('is-live', S.lyricsOpen);
      el.lyricsBtn.setAttribute('aria-expanded', S.lyricsOpen ? 'true' : 'false');
    }

    el.trHead.hidden = S.lyricsOpen;
    el.tracks.hidden = S.lyricsOpen;
    el.lyricsBox.hidden = !S.lyricsOpen;
    if (!S.lyricsOpen) { paintTrackNote(); return; }

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
    paintHeader();
    paintTabs();
    paintLcd();
    paintTransport();
    paintStats();
    paintTracks();
    paintLyrics();
  }

  /* ── knobs ───────────────────────────────────────────── */

  function knobDrag(e, get, set) {
    e.preventDefault();
    var start = { x: e.clientX, y: e.clientY, v: get() };
    function move(ev) { set(start.v + (start.y - ev.clientY + (ev.clientX - start.x)) / 140); }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function setVol(v) {
    S.vol = Math.min(1, Math.max(0, v));
    music.volume = S.vol;
    pod.volume = S.vol;
    paintTransport();
  }


  /* ── canvas background ───────────────────────────────── */

  function sizeCanvas() {
    var c = el.bg;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }

  function drawBg() {
    var c = el.bg;
    if (!c || !c.width) return;
    var g2d = c.getContext('2d');
    var w = c.width / dpr, h = c.height / dpr;
    var n = lev.length;
    var sum = 0;
    for (var i = 0; i < n; i++) sum += lev[i];
    amp = amp * 0.9 + (sum / n) * 0.1;

    var t = performance.now() / 1000;
    var k = theme(S.skin);
    var rgb = [1, 3, 5].map(function (j) { return parseInt(k.ac.slice(j, j + 2), 16); }).join(', ');
    var step = 24;

    g2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2d.clearRect(0, 0, w, h);

    for (var x = step / 2; x < w; x += step) {
      var col = Math.floor((x / w) * n);
      var l = lev[Math.min(n - 1, col)] || 0;
      for (var y = step / 2; y < h; y += step) {
        var wave = Math.sin((y / h) * 5 - t * 0.9 + (x / w) * 3) * 0.5 + 0.5;
        var a = 0.018 + l * 0.10 * wave + amp * 0.05 * wave;
        if (a < 0.02) continue;
        var r = 1 + l * wave * 2.2;
        g2d.fillStyle = 'rgba(' + rgb + ', ' + Math.min(0.2, a).toFixed(3) + ')';
        g2d.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }

    var glow = 40 + amp * 260;
    var grad = g2d.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, glow + 320);
    grad.addColorStop(0, 'rgba(' + rgb + ', ' + (0.02 + amp * 0.06).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(' + rgb + ', 0)');
    g2d.fillStyle = grad;
    g2d.fillRect(0, 0, w, h);
  }

  // The analyser is wired to the music element. Anything else is simulated.
  function analysing() { return !!analyser && !simVis && audio === music; }

  function frame() {
    var kids = el.vis.children;
    var n = lev.length;

    if (analysing()) {
      analyser.getByteFrequencyData(freq);
      var step = Math.floor(freq.length * 0.7 / n) || 1;
      for (var i = 0; i < n; i++) {
        var v = (freq[i * step] || 0) / 255;
        lev[i] = Math.max(v, lev[i] * 0.86);
      }
    } else {
      var t = performance.now() / 1000;
      var on = S.playing ? 1 : 0.05;
      for (var j = 0; j < n; j++) {
        var b = (Math.sin(t * 2.1 + j * 0.5) * 0.5 + 0.5) * (Math.sin(t * 5.7 + j * 1.31) * 0.5 + 0.5);
        lev[j] = lev[j] * 0.72 + b * (1 - (j / n) * 0.55) * on * 0.28;
      }
    }

    for (var q = 0; q < kids.length && q < n; q++) {
      kids[q].style.height = (4 + lev[q] * 96).toFixed(1) + '%';
    }

    if (!reduceMotion) drawBg();
    requestAnimationFrame(frame);
  }

  /* ── fit-to-viewport ─────────────────────────────────── */

  function measureFit() {
    var w = window.innerWidth, h = window.innerHeight;
    if (!w || !h) return;

    // The head sets --fit before first paint; this keeps it current on resize.
    var fit = w <= 900
      ? 1
      : Math.max(0.2, Math.min(1, (w - 40) / CANVAS_W, (h - 40) / CANVAS_H));
    if (fit === S.fit) return;
    S.fit = fit;
    document.documentElement.style.setProperty('--fit', fit);
  }

  /* ── boot ────────────────────────────────────────────── */

  function boot() {
    [
      'bg', 'fit', 'app', 'netActive', 'netSessions', 'netHours', 'themeBtn', 'themeMenu',
      'themeCaret', 'skinName', 'stationLabel', 'srcLabel',
      'marq', 'artist', 'curTime', 'durTime', 'vis', 'prev', 'toggle', 'stop', 'next',
      'playGlyph', 'seek', 'seekFill', 'seekHead', 'volKnob', 'volRot', 'volLabel',
      'tileActive', 'tilePeak', 'tileSessions', 'tileHours',
      'playlistKind', 'playlistName', 'tracks', 'trHead', 'playlistNote',
      'geoList', 'peak', 'status', 'seg', 'tabSongs', 'tabPodcast',
      'lyricsBtn', 'lyricsBox', 'lyrics',
      'backToRadio', 'installBtn'
    ].forEach(function (id) { el[id] = $(id); });

    buildThemeMenu();
    applyTheme();
    buildBars();
    buildAudio();
    wireGestures();

    el.themeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      S.themeOpen ? closeThemes() : openThemes();
    });
    document.addEventListener('click', function (e) {
      if (S.themeOpen && !e.target.closest('.picker')) closeThemes();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && S.themeOpen) { closeThemes(); el.themeBtn.focus(); }
    });

    el.toggle.addEventListener('click', toggle);
    el.stop.addEventListener('click', stop);
    el.next.addEventListener('click', next);
    el.prev.addEventListener('click', prev);
    el.lyricsBtn.addEventListener('click', toggleLyrics);
    el.lyrics.addEventListener('scroll', lyricsScrolledByHand);

    el.seek.addEventListener('click', function (e) {
      if (!nowItem() || !S.dur) return;
      var r = e.currentTarget.getBoundingClientRect();
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
      if (e.target.matches('input, textarea, [contenteditable]')) return;
      if (e.code === 'Space') { toggle(); e.preventDefault(); }
    });

    window.addEventListener('resize', function () { sizeCanvas(); measureFit(); });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { sizeCanvas(); measureFit(); }).observe(document.body);
    }

    paintAll();
    sizeCanvas();
    measureFit();
    requestAnimationFrame(frame);

    tuneIn();
    loadTracks();
    if (SHOW_PODCAST) loadStories();
    loadStats();
    setInterval(loadStats, STATS_INTERVAL);
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
       the bar. A route that names nothing here is not a reason to go quiet,
       so the stream answers and the address says so. */
    window.addEventListener('popstate', function () {
      var r = here();
      if (navigate(r, 'replace')) return;
      S.route = r.known ? r.kind : '';
      playRadio('replace');
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
      if (vw) vw.hidden = true;
    }

    if ('serviceWorker' in navigator) {
      // Nothing here depends on it, so a failure is not worth reporting.
      navigator.serviceWorker.register('/sw.js').catch(function () { /* fine without */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
