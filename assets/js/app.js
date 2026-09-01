/* Omarchy Radio — player logic.
   Vanilla reimplementation of the source design's component: theme derivation,
   ICY metadata parsing, live statistics, Web Audio analysis and the canvas
   background. No dependencies. */

(function () {
  'use strict';

  var HOST = 'https://radio.cliamp.stream';

  // On-demand tracks live in the repo so they can arrive by pull request.
  // The live stream still comes from HOST.
  var TRACKS_DIR = 'tracks/';
  var TRACKS_MANIFEST = 'tracks/playlist.json';
  var BAR_COUNT = 56;
  var STATS_INTERVAL = 30000;
  var CANVAS_W = 1180;
  var CANVAS_H = 880;
  var STORE_KEY = 'omarchy-radio-skin';

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

  function num(n) {
    if (n == null) return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
    if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k';
    return String(Math.round(n));
  }

  /* ── state ───────────────────────────────────────────── */

  var S = {
    st: 0,
    mode: 'radio',
    ti: -1,
    tracks: [],
    playing: false,
    vol: 0.8,
    bal: 0,
    cur: 0,
    dur: 0,
    skin: 0,
    themeOpen: false,
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
  var audio, ctx, analyser, panner, freq, metaAbort, dpr = 1;
  var loadedSrc = '';
  var intent = 'idle'; // 'play' | 'pause' | 'stop' — what the listener last asked for
  var retryN = 0, retryTimer = null, lastProgress = 0;

  var el = {};

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
    el.footSkin.textContent = k.name;
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

    if (retryN >= RETRY_MAX) { setStatus('stream unreachable — press play'); return; }

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

  function buildAudio() {
    var a = new Audio();
    a.preload = 'none';
    a.crossOrigin = 'anonymous';
    a.volume = S.vol;

    a.addEventListener('timeupdate', function () {
      lastProgress = Date.now();
      S.cur = a.currentTime || 0;
      S.dur = isFinite(a.duration) ? a.duration : 0;
      paintClock();
    });
    a.addEventListener('ended', function () {
      // A live stream has no end; reaching one means the connection went.
      if (S.mode === 'radio') scheduleReconnect();
      else next();
    });
    a.addEventListener('playing', function () {
      cancelReconnect();
      lastProgress = Date.now();
      S.playing = true;
      setStatus(S.mode === 'radio' ? 'streaming live' : 'playing');
      paintTransport();
    });
    a.addEventListener('pause', function () {
      // pause fires asynchronously, after stop() has already set its status.
      // Only a deliberate pause calls off a reconnect; a dropped stream also
      // pauses the element, and there intent is still 'play'.
      if (intent === 'pause' || intent === 'stop') cancelReconnect();
      S.playing = false;
      setStatus(intent === 'stop' ? 'stopped' : 'paused');
      paintTransport();
    });
    a.addEventListener('waiting', function () { setStatus('buffering…'); });
    a.addEventListener('error', function () { scheduleReconnect(); });

    audio = a;
  }

  /* iOS ignores writes to HTMLMediaElement.volume, leaving the hardware
     buttons in charge. The knob still turned and the number still moved,
     it just did nothing to the sound, which is worse than not offering it.
     Feature detected rather than sniffed, so it corrects itself if the
     platform ever changes its mind. Balance goes through a Web Audio
     panner, which does work there, so it stays either way. */
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

  function wireGraph() {
    if (ctx || !audio) return;
    try {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      var c = new C();
      var src = c.createMediaElementSource(audio);
      var an = c.createAnalyser();
      an.fftSize = 512;
      an.smoothingTimeConstant = 0.75;
      var node = src;
      if (c.createStereoPanner) {
        panner = c.createStereoPanner();
        panner.pan.value = S.bal;
        node.connect(panner);
        node = panner;
      }
      node.connect(an);
      an.connect(c.destination);
      ctx = c;
      analyser = an;
      freq = new Uint8Array(an.frequencyBinCount);
      simVis = false;
    } catch (e) {
      simVis = true;
    }
  }

  function wantedSrc() {
    if (mode_is_track() && S.tracks[S.ti]) return S.tracks[S.ti].url;
    return HOST + '/' + STATIONS[S.st].slug + '/stream';
  }

  function mode_is_track() { return S.mode === 'track'; }

  function play(src, mode, ti) {
    intent = 'play';
    loadedSrc = src;
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
      if (err && err.name === 'NotAllowedError') setStatus('press play to start');
    });
    S.mode = mode;
    S.ti = ti;
    S.cur = 0;
    S.dur = 0;
    lastProgress = Date.now();
    setStatus('connecting…');
    paintAll();
  }

  function playRadio() {
    play(HOST + '/' + STATIONS[S.st].slug + '/stream', 'radio', -1);
  }

  function playTrack(i) {
    var t = S.tracks[i];
    if (t) play(t.url, 'track', i);
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
  }

  function stop() {
    intent = 'stop';
    cancelReconnect();
    audio.pause();
    try { audio.currentTime = 0; } catch (e) { /* live stream */ }
    loadedSrc = '';
    S.playing = false;
    S.cur = 0;
    setStatus('stopped');
    paintAll();
  }

  // There is one station, so these only ever step the on-demand tracks.
  function next() {
    if (S.mode === 'track' && S.tracks.length) playTrack((S.ti + 1) % S.tracks.length);
  }

  function prev() {
    if (S.mode === 'track' && S.tracks.length) playTrack((S.ti - 1 + S.tracks.length) % S.tracks.length);
  }


  /* ── network ─────────────────────────────────────────── */

  function startMeta() {
    if (metaAbort) metaAbort.abort();
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

  function loadStats() {
    fetch(HOST + '/statistics').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.stations) {
        S.stats = j;
        paintStats();
        paintHeader();
      }
    }).catch(function () { /* stats optional */ });
  }

  function loadTracks() {
    fetch(TRACKS_MANIFEST).then(function (r) {
      if (!r.ok) throw new Error('no playlist');
      return r.json();
    }).then(function (j) {
      S.tracks = ((j && j.tracks) || []).map(resolveTrack);
      paintTracks();
    }).catch(function () {
      S.tracks = [];
      paintTracks();
    });
  }

  // A contributed entry names its file and nothing else; encoding happens
  // here so nobody has to hand-escape spaces or accents in the manifest. An
  // entry that already carries a url is left alone.
  function resolveTrack(t) {
    if (t.url) return t;
    var r = { title: t.title, artist: t.artist, album: t.album };
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

  function paintLcd() {
    var cur = STATIONS[S.st];
    var t = S.mode === 'track' ? S.tracks[S.ti] : null;
    var live = S.mode === 'radio';

    el.stationLabel.textContent = cur.name.toLowerCase() + ' · ' + cur.tag;
    el.srcLabel.textContent = live ? '◉ live stream' : 'playlist · track ' + (S.ti + 1);

    // Filled while the live stream is the source, dot blinking only when
    // it is actually playing rather than merely selected.
    el.backToRadio.classList.toggle('is-live', live);
    el.backToRadio.classList.toggle('is-onair', live && S.playing);

    var marquee = t
      ? (t.title + '  —  ' + t.artist)
      : (S.icyTitle ? S.icyTitle : (S.icyName || cur.name) + '  —  ' + cur.tag);
    Array.prototype.forEach.call(el.marq.children, function (n) { n.textContent = marquee; });

    setMediaMeta(
      t ? t.title : (S.icyTitle || S.icyName || cur.name),
      t ? t.artist : (S.icyTitle ? (S.icyName || cur.name) : cur.tag)
    );

    el.artist.textContent = t
      ? (t.album || t.artist)
      : [S.icyName || cur.name, S.icyGenre, S.icyTitle ? 'on air now' : 'continuous rotation']
          .filter(Boolean).join(' · ');

    document.title = (S.playing ? marquee.replace(/\s+/g, ' ').trim() + ' — ' : '') +
      'Omarchy Radio';

    el.playlistName.textContent = cur.name.toLowerCase();
    el.geoName.textContent = cur.name.toLowerCase();
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
    el.playGlyph.textContent = S.playing ? '❙❙' : '▶';
    el.toggle.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    el.volRot.style.transform = 'rotate(' + (-135 + S.vol * 270) + 'deg)';
    el.balRot.style.transform = 'rotate(' + (S.bal * 135) + 'deg)';
    el.volLabel.textContent = Math.round(S.vol * 100);
    el.balLabel.textContent = S.bal === 0
      ? 'c'
      : (S.bal < 0 ? 'l' : 'r') + Math.round(Math.abs(S.bal) * 100);
    el.volKnob.setAttribute('aria-valuenow', Math.round(S.vol * 100));
    el.balKnob.setAttribute('aria-valuenow', Math.round(S.bal * 100));
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

  function paintTracks() {
    el.tracks.innerHTML = '';
    var frag = document.createDocumentFragment();
    S.tracks.forEach(function (tr, i) {
      var on = i === S.ti && S.mode === 'track';
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'track' + (on ? ' is-on' : '');
      b.innerHTML =
        '<span class="tr-n"></span>' +
        '<span class="tr-t"><span class="tr-title"></span><span class="tr-artist"></span></span>' +
        '<span class="tr-s"></span>';
      b.querySelector('.tr-n').textContent = String(i + 1).padStart(2, '0');
      b.querySelector('.tr-title').textContent = tr.title;
      b.querySelector('.tr-artist').textContent = tr.artist;
      b.querySelector('.tr-s').textContent = on ? (S.playing ? 'playing' : 'paused') : '';
      b.addEventListener('click', function () { playTrack(i); });
      li.appendChild(b);
      frag.appendChild(li);
    });
    el.tracks.appendChild(frag);
    el.playlistNote.textContent = S.tracks.length
      ? S.tracks.length + ' tracks on demand'
      : 'live rotation only — no track list on this stream';
  }

  function paintAll() {
    paintHeader();
    paintLcd();
    paintTransport();
    paintStats();
    paintTracks();
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
    audio.volume = S.vol;
    paintTransport();
  }

  function setBal(v) {
    S.bal = Math.min(1, Math.max(-1, v));
    if (panner) panner.pan.value = S.bal;
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

  function frame() {
    var kids = el.vis.children;
    var n = lev.length;

    if (analyser && !simVis) {
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
      'balKnob', 'balRot', 'balLabel', 'tileActive', 'tilePeak', 'tileSessions', 'tileHours',
      'playlistName', 'geoName', 'tracks', 'playlistNote', 'geoList', 'peak', 'status',
      'footSkin', 'backToRadio'
    ].forEach(function (id) { el[id] = $(id); });

    buildThemeMenu();
    applyTheme();
    buildBars();
    buildAudio();

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
    el.backToRadio.addEventListener('click', playRadio);

    el.seek.addEventListener('click', function (e) {
      if (S.mode !== 'track' || !S.dur) return;
      var r = e.currentTarget.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      audio.currentTime = p * S.dur;
      S.cur = p * S.dur;
      paintClock();
    });
    el.seek.addEventListener('keydown', function (e) {
      if (S.mode !== 'track' || !S.dur) return;
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

    el.balKnob.addEventListener('pointerdown', function (e) {
      knobDrag(e, function () { return S.bal; }, setBal);
    });
    el.balKnob.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { setBal(S.bal + 0.1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { setBal(S.bal - 0.1); e.preventDefault(); }
      if (e.key === 'Home') { setBal(0); e.preventDefault(); }
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

    loadTracks();
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

    if (!volumeIsSettable()) {
      var vw = el.volKnob.closest('.knob-wrap');
      if (vw) vw.hidden = true;
    }

    if ('serviceWorker' in navigator) {
      // Nothing here depends on it, so a failure is not worth reporting.
      navigator.serviceWorker.register('sw.js').catch(function () { /* fine without */ });
    }

    // No autoplay: the stream connects only when the listener presses play.
    // Metadata is still read so the display shows what is currently on air.
    startMeta();
    setStatus('ready');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
