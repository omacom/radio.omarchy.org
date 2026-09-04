// Paired stems have one AudioContext clock, one seek decision and one offset.
export function joinPosition(manifest, elapsed = 0) {
  return Math.max(
    manifest.firstSequence * manifest.segmentSeconds,
    (manifest.serverTime - manifest.epoch) / 1000 +
      elapsed -
      manifest.latencySeconds,
    0,
  );
}
export function duckLevel(links, position, rate = 44100) {
  let level = 1;
  for (const link of links) {
    const start = link.start / rate,
      end = link.end / rate;
    if (position >= start - 0.12 && position < start)
      level = Math.min(level, 1 - (0.76 * (position - start + 0.12)) / 0.12);
    else if (position >= start && position < end) level = 0.24;
    else if (position >= end && position < end + 0.45)
      level = Math.min(level, 0.24 + (0.76 * (position - end)) / 0.45);
  }
  return level;
}
export class RadioPlayer {
  constructor({
    baseURL = "",
    fetcher = fetch,
    AudioContextClass = globalThis.AudioContext ??
      globalThis.webkitAudioContext,
  } = {}) {
    this.baseURL = baseURL;
    this.fetch = (url, ...args) =>
      fetcher(baseURL ? new URL(url, baseURL).href : url, ...args);
    this.Context = AudioContextClass;
    this.generation = 0;
    this.enabled = true;
    this.volume = 0.8;
    this.pairs = [];
    this.onState = () => {};
    this.onMetadata = () => {};
    this.running = false;
    this.anchored = false;
  }
  get position() {
    return this.context && this.anchored
      ? this.context.currentTime - this.anchor
      : 0;
  }
  async start() {
    this.stop();
    const generation = this.generation;
    const ctx = new this.Context({ sampleRate: 44100 });
    this.context = ctx;
    this.running = true;
    this.listener = crypto.randomUUID();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    this.voice = ctx.createGain();
    this.voice.gain.value = this.enabled ? 1 : 0;
    this.voice.connect(this.master);
    this.analyser = ctx.createAnalyser();
    this.master.disconnect();
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    await ctx.resume();
    if (generation !== this.generation) return;
    this.onState("connecting…", false);
    this.timer = setInterval(() => {
      this.metadata();
      void this.fill();
    }, 500);
    ctx.onstatechange = () => {
      if (ctx !== this.context) return;
      if (ctx.state !== "running")
        this.onState("audio suspended — press play", false);
      else {
        this.anchored = false;
        void this.fill();
      }
    };
    await this.fill();
  }
  stop() {
    this.generation++;
    clearInterval(this.timer);
    this.abort?.abort();
    this.clear();
    const ctx = this.context;
    this.context = null;
    if (ctx) {
      ctx.onstatechange = null;
      void ctx.close();
    }
    this.running = false;
    this.busy = false;
    this.anchored = false;
    this.manifest = null;
  }
  clear() {
    for (const p of this.pairs) {
      try {
        p.music.stop();
        p.dj?.stop();
      } catch {}
      p.gain.disconnect();
    }
    this.pairs = [];
  }
  async resume() {
    if (this.context?.state !== "running") await this.context.resume();
    this.anchored = false;
    await this.fill();
  }
  setVolume(value) {
    this.volume = value;
    if (this.context)
      this.master.gain.setTargetAtTime(value, this.context.currentTime, 0.025);
  }
  setDJ(enabled) {
    this.enabled = enabled;
    if (this.context)
      this.voice.gain.setTargetAtTime(
        enabled ? 1 : 0,
        this.context.currentTime,
        0.025,
      );
    for (const pair of this.pairs) this.duck(pair);
  }
  duck(pair) {
    const now = this.context.currentTime,
      g = pair.gain.gain;
    if (pair.end <= now) return;
    g.cancelScheduledValues(now);
    g.setValueAtTime(
      this.enabled && pair.dj ? duckLevel(pair.links, this.position) : 1,
      now,
    );
    if (!this.enabled || !pair.dj) return;
    // Each segment includes adjacent envelope metadata, including recovery tails.
    const points = new Set([Math.max(now, pair.start), pair.end]);
    for (const link of pair.links)
      for (const t of [
        link.start / 44100 - 0.12,
        link.start / 44100,
        link.end / 44100,
        link.end / 44100 + 0.45,
      ]) {
        const at = this.anchor + t;
        if (at > now && at >= pair.start && at <= pair.end) points.add(at);
      }
    for (const at of [...points].sort((a, b) => a - b))
      g.linearRampToValueAtTime(duckLevel(pair.links, at - this.anchor), at);
  }
  metadata() {
    if (!this.context) return;
    const pair = this.pairs.find(
      (p) =>
        p.start <= this.context.currentTime && p.end > this.context.currentTime,
    );
    if (!pair) return;
    const frame = Math.floor(this.position * 44100);
    this.onMetadata(
      pair.slots.find((s) => s.start <= frame && s.end > frame) ?? null,
      pair.links.find((l) => l.start <= frame && l.end > frame) ?? null,
    );
  }
  async audio(stem, ctx, signal, pair) {
    const response = await this.fetch(stem.url, { cache: "no-store", signal });
    if (!response.ok) throw new Error("Audio unavailable");
    const data = await response.arrayBuffer();
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== stem.sha256) throw new Error("Audio integrity mismatch");
    const buffer = await ctx.decodeAudioData(data);
    if (
      Math.abs(buffer.duration - pair.decodedFrames / 44100) >
        1 / ctx.sampleRate ||
      buffer.numberOfChannels !== 2
    )
      throw new Error("MP3 gapless timing is unsupported by this decoder");
    const length = Math.round((pair.frames * ctx.sampleRate) / 44100),
      start = Math.round((pair.trimStart * ctx.sampleRate) / 44100);
    const trimmed = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++)
      trimmed.copyToChannel(
        buffer.getChannelData(channel).subarray(start, start + length),
        channel,
      );
    return trimmed;
  }
  async fill() {
    if (this.busy || !this.context || this.context.state !== "running") return;
    this.busy = true;
    const generation = this.generation,
      ctx = this.context;
    const controller = new AbortController();
    this.abort = controller;
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const sent = performance.now(),
        response = await this.fetch("/api/station?listener=" + this.listener, {
          cache: "no-store",
          signal: controller.signal,
        });
      if (!response.ok) throw new Error("Station unavailable");
      const manifest = await response.json();
      if (generation !== this.generation) return;
      if (
        manifest.version !== 2 ||
        manifest.sampleRate !== 44100 ||
        !manifest.pairs.length
      )
        throw new Error("Station is preparing audio");
      const target = joinPosition(manifest, (performance.now() - sent) / 2000);
      if (
        !this.anchored ||
        manifest.broadcast !== this.broadcast ||
        Math.abs(target - this.position) > 1.5
      ) {
        this.clear();
        this.broadcast = manifest.broadcast;
        this.target = target;
        this.next = Math.floor(target / manifest.segmentSeconds);
        this.anchored = false;
      }
      this.manifest = manifest;
      this.pairs = this.pairs.filter((p) => p.end > ctx.currentTime);
      let count = 0;
      while (this.next <= manifest.lastSequence && count++ < 5) {
        if (
          this.anchored &&
          this.next * manifest.segmentSeconds > this.position + 16
        )
          break;
        const pair = manifest.pairs.find((p) => p.sequence === this.next);
        if (
          !pair ||
          pair.broadcast !== manifest.broadcast ||
          pair.startFrame !== pair.sequence * manifest.segmentSeconds * 44100 ||
          pair.frames !== manifest.segmentSeconds * 44100 ||
          pair.codec !== "mp3" ||
          pair.trimStart !== 2304 ||
          pair.decodedFrames !== pair.frames + 4608
        )
          throw new Error("Pair metadata mismatch");
        const [musicResult, djResult] = await Promise.allSettled([
          this.audio(pair.stems.music, ctx, controller.signal, pair),
          this.audio(pair.stems.dj, ctx, controller.signal, pair),
        ]);
        if (generation !== this.generation) return;
        if (musicResult.status === "rejected") throw musicResult.reason;
        if (!this.anchored) {
          this.anchor = ctx.currentTime + 0.15 - this.target;
          this.anchored = true;
        }
        const start = this.anchor + pair.startFrame / 44100,
          when = Math.max(ctx.currentTime + 0.015, start),
          offset = when - start;
        this.next++;
        if (offset >= manifest.segmentSeconds) continue;
        const music = ctx.createBufferSource(),
          gain = ctx.createGain();
        music.buffer = musicResult.value;
        music.connect(gain);
        gain.connect(this.master);
        let dj;
        if (djResult.status === "fulfilled") {
          dj = ctx.createBufferSource();
          dj.buffer = djResult.value;
          dj.connect(this.voice);
        }
        // Include envelope neighbours from sealed pair metadata, never mutable briefs.
        const links = [
          ...new Map(
            manifest.pairs.flatMap((p) => p.links).map((l) => [l.id, l]),
          ).values(),
        ].filter(
          (l) =>
            l.end / 44100 + 0.45 > pair.startFrame / 44100 &&
            l.start / 44100 - 0.12 < (pair.startFrame + pair.frames) / 44100,
        );
        const scheduled = {
          music,
          dj,
          gain,
          start,
          end: start + manifest.segmentSeconds,
          slots: pair.slots,
          links,
        };
        this.duck(scheduled);
        music.start(when, offset);
        dj?.start(when, offset);
        this.pairs.push(scheduled);
        music.onended = () => {
          music.disconnect();
          gain.disconnect();
          dj?.disconnect();
        };
        this.onState(
          dj ? "streaming live" : "streaming live · DJ unavailable",
          true,
        );
      }
      this.metadata();
    } catch (error) {
      if (generation === this.generation) {
        if (this.lastError !== error.message)
          console.warn("Station playback:", error.message);
        this.lastError = error.message;
        this.onState(
          "buffering — reconnecting",
          this.pairs.some((p) => p.end > ctx.currentTime),
        );
      }
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) this.busy = false;
    }
  }
}
