import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { atomic, readJSON } from "./storage.mjs";
import {
  RATE,
  SEGMENT,
  frames,
  encode,
  copyFileWindow,
  furniture,
  decodeVoice,
  MP3_GUARD,
} from "./audio.mjs";
import { micWindows, admit } from "./clock.mjs";
import {
  programme,
  scheduleUpdate,
  programmeSlots,
  programmeContext,
} from "./programme.mjs";
import { sheetContext } from "./track-sheet.mjs";
import { Editorial } from "./editorial.mjs";
import { sourceTools } from "./sources.mjs";
import { renderVoice } from "./providers.mjs";

const RETAIN = frames(120),
  LOOKAHEAD = frames(20);
export class Station {
  constructor(tracks, data, root, options = {}) {
    this.tracks = tracks;
    this.data = data;
    this.root = root;
    this.clock = options.clock ?? Date.now;
    this.encoder = options.encode ?? encode;
    this.voice = options.voice ?? renderVoice;
    this.decode = options.decode ?? decodeVoice;
    this.recorder = options.recorder;
    this.event = options.event ?? (() => Promise.resolve());
    this.model = options.model;
    this.tools = options.tools ?? sourceTools(root);
    this.queue = Promise.resolve();
    this.preparing = false;
    this.rendering = false;
    this.sealed = new Map();
    this.metrics = {
      sealed: 0,
      rejected: 0,
      editorialFailures: 0,
      renderFailures: 0,
    };
  }
  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }
  now() {
    return Math.max(0, frames((this.clock() - this.state.epoch) / 1000));
  }
  async initialize() {
    await mkdir(join(this.data, "segments"), { recursive: true });
    this.state = await readJSON(join(this.data, "station.json"), null);
    if (this.state && this.state.version !== 2)
      throw new Error(
        "This data directory uses the old experimental transport. Select a fresh RADIO_DATA directory for MP3.",
      );
    if (!this.state)
      this.state = {
        version: 2,
        epoch: this.clock(),
        broadcast: randomUUID(),
        programmes: [programme(this.tracks)],
        links: [],
        attempted: [],
        editorial: {},
      };
    scheduleUpdate(this.state.programmes, this.tracks, this.now());
    this.tracks = [
      ...new Map(
        this.state.programmes.flatMap((p) => p.tracks).map((t) => [t.id, t]),
      ).values(),
    ];
    this.editorial = new Editorial(
      this.state.editorial,
      this.tools,
      this.model,
      this.clock,
    );
    for (const link of this.state.links) {
      const story = this.state.editorial.stories.find(
        (s) => s.id === link.source?.id,
      );
      if (story) story.scheduled = link.id;
    }
    this.editorial.reconcile(this.state.links, this.now());
    await this.persist();
    for (const directory of ["voice", "tts"]) {
      await mkdir(join(this.data, directory), { recursive: true });
      const active = new Set(this.state.links.map((l) => l.path));
      for (const name of await readdir(join(this.data, directory))) {
        const path = join(this.data, directory, name);
        if (!active.has(path)) await rm(path, { force: true });
      }
    }
    await this.render();
  }
  persist() {
    return atomic(join(this.data, "station.json"), JSON.stringify(this.state));
  }
  async commit(window, text, pcm, brief) {
    return this.exclusive(async () => {
      const length = pcm.length / 4;
      if (
        !admit(
          window,
          length,
          this.now(),
          this.sealedThrough ?? 0,
          this.state.links,
        )
      ) {
        this.metrics.rejected++;
        return false;
      }
      const id = randomUUID(),
        path = join(this.data, "voice", `${id}.raw`);
      await atomic(path, pcm);
      // Disk latency counts against admission, too.
      if (
        !admit(
          window,
          length,
          this.now(),
          this.sealedThrough ?? 0,
          this.state.links,
        )
      ) {
        await rm(path);
        this.metrics.rejected++;
        return false;
      }
      const source = brief
        ? {
            id: brief.source.id,
            title: brief.source.title,
            author: brief.source.author,
            url: brief.source.url,
            publishedAt: brief.source.publishedAt,
            retrievedAt: brief.source.retrievedAt,
          }
        : null;
      const link = {
        id,
        start: window.start,
        end: window.start + length,
        text,
        source,
        path,
        purpose: brief ? "community" : "continuity",
      };
      this.state.links.push(link);
      try {
        await this.persist();
      } catch (error) {
        this.state.links.pop();
        await rm(path);
        throw error;
      }
      if (
        !admit(
          window,
          length,
          this.now(),
          this.sealedThrough ?? 0,
          this.state.links.filter((l) => l.id !== id),
        )
      ) {
        this.state.links.pop();
        await this.persist();
        await rm(path);
        this.metrics.rejected++;
        return false;
      }
      this.editorial.scheduled(brief, text, id);
      await this.persist();
      await this.event("link_committed", {
        link: { ...link, path: undefined },
      });
      return true;
    });
  }
  async prepare() {
    if (this.preparing) return;
    this.preparing = true;
    let file;
    try {
      const now = this.now();
      this.editorial.reconcile(this.state.links, now);
      const candidates = programmeSlots(
        this.state.programmes,
        now + frames(45),
        now + frames(300),
      ).flatMap((slot) =>
        micWindows(slot, this.trackFor(slot)).map((window) => ({
          slot,
          window,
        })),
      );
      const candidate = candidates.find(
        ({ window }) =>
          window.start > now + frames(45) &&
          !this.state.attempted.includes(window.id) &&
          admit(window, 1, now, this.sealedThrough ?? 0, this.state.links),
      );
      if (!candidate) return;
      const { slot, window } = candidate;
      this.state.attempted.push(window.id);
      this.state.attempted = this.state.attempted.slice(-500);
      await this.exclusive(() => this.persist());
      let brief = null,
        text = null,
        editorialUnavailable = false;
      const context = programmeContext(this.state.programmes, slot, window),
        track = this.trackFor(slot);
      if (track)
        context.trackSheet = sheetContext(
          track.sheet,
          window,
          slot.start,
          RATE,
        );
      try {
        brief = await this.editorial.brief();
        text = await this.editorial.present(brief, context);
      } catch {
        this.metrics.editorialFailures++;
        editorialUnavailable = true;
      }
      // Sparse, truthful station furniture is available without an LLM.
      if (!text && editorialUnavailable && slot.type === "junction" && !brief)
        text = "Omarchy Radio. Music made by the community.";
      if (!text) {
        await this.event("mic_closed", {
          window,
          reason: "presenter declined",
        });
        return;
      }
      file = await this.voice(join(this.data, "tts"), randomUUID(), text);
      const pcm = await this.decode(file);
      await this.event("speech_measured", {
        frames: pcm.length / 4,
        window,
        text,
      });
      const accepted = await this.commit(window, text, pcm, brief);
      if (!accepted)
        await this.event("mic_closed", {
          window,
          reason: "late, overlong, or cadence guard",
        });
    } catch {
      this.metrics.editorialFailures++;
    } finally {
      if (file) await rm(file, { force: true }).catch(() => {});
      this.preparing = false;
    }
  }
  trackFor(slot) {
    const p = this.state.programmes.findLast((p) => p.from <= slot.start);
    return p?.tracks.find((t) => t.id === slot.trackId);
  }
  furnitureFor(slot) {
    const p = this.state.programmes.findLast((p) => p.from <= slot.start);
    return p?.tracks.find((t) => t.furniture?.id === slot.furnitureId)
      ?.furniture;
  }
  presentation(start, end) {
    const links = this.state.links.filter(
      (l) => l.end > start && l.start < end,
    );
    for (const slot of programmeSlots(this.state.programmes, start, end)) {
      if (slot.type !== "junction" || !slot.furnitureId) continue;
      const f = this.furnitureFor(slot),
        ident = f.idents[slot.rotation % f.idents.length];
      const at = slot.start + frames(0.15);
      if (at < end && at + ident.frames > start)
        links.push({
          id: slot.id + "-ident",
          start: at,
          end: at + ident.frames,
          path: ident.path,
          text: ident.text,
          purpose: "ident",
          prerecorded: true,
          source: null,
        });
    }
    return links;
  }
  async pcm(start, end) {
    const music = Buffer.alloc((end - start) * 4),
      dj = Buffer.alloc(music.length);
    for (const slot of programmeSlots(
      this.state.programmes,
      Math.max(0, start),
      end,
    )) {
      const from = Math.max(start, slot.start),
        to = Math.min(end, slot.end);
      if (slot.type === "track")
        await copyFileWindow(
          music,
          this.trackFor(slot).path,
          slot.start,
          start,
          to,
        );
      else if (slot.furnitureId) {
        const f = this.furnitureFor(slot);
        const stingEnd = Math.min(end, slot.start + f.sting.frames);
        if (start < stingEnd)
          await copyFileWindow(
            music,
            f.sting.path,
            slot.start,
            start,
            stingEnd,
          );
        const bedStart = slot.start + f.sting.frames;
        if (end > bedStart)
          await copyFileWindow(music, f.bed.path, bedStart, start, to);
      } else
        furniture(to - from, from - slot.start).copy(music, (from - start) * 4);
    }
    for (const link of this.presentation(start, end))
      await copyFileWindow(
        dj,
        link.path,
        link.start,
        start,
        Math.min(end, link.end),
      );
    return { music, dj };
  }
  async makeSegment(sequence) {
    const start = sequence * frames(SEGMENT),
      end = start + frames(SEGMENT);
    return this.exclusive(async () => {
      const directory = join(
        this.data,
        "segments",
        `${this.state.broadcast}-${sequence}`,
      );
      const existing = await readJSON(join(directory, "pair.json"), null);
      if (existing) {
        this.sealed.set(sequence, existing);
        this.sealedThrough = Math.max(this.sealedThrough ?? 0, end + MP3_GUARD);
        return;
      }
      this.sealedThrough = Math.max(this.sealedThrough ?? 0, end + MP3_GUARD);
      const { music, dj } = await this.pcm(start - MP3_GUARD, end + MP3_GUARD);
      const slots = programmeSlots(this.state.programmes, start, end);
      const links = this.presentation(start - frames(0.45), end + frames(0.12));
      const [musicFile, djFile] = await Promise.all([
        this.encoder(music),
        this.encoder(dj),
      ]);
      await atomic(join(directory, "music.mp3"), musicFile);
      await atomic(join(directory, "dj.mp3"), djFile);
      const digest = (buffer) =>
        createHash("sha256").update(buffer).digest("hex");
      const pair = {
        broadcast: this.state.broadcast,
        sequence,
        startFrame: start,
        frames: frames(SEGMENT),
        sampleRate: RATE,
        codec: "mp3",
        trimStart: MP3_GUARD,
        decodedFrames: frames(SEGMENT) + 2 * MP3_GUARD,
        stems: {
          music: {
            url: `/api/audio/${this.state.broadcast}/${sequence}/music.mp3`,
            sha256: digest(musicFile),
          },
          dj: {
            url: `/api/audio/${this.state.broadcast}/${sequence}/dj.mp3`,
            sha256: digest(djFile),
          },
        },
        slots,
        links: links.map(({ path, ...l }) => l),
      };
      // Marker is published last. Clients cannot observe half a pair.
      await atomic(join(directory, "pair.json"), JSON.stringify(pair));
      this.sealed.set(sequence, pair);
      this.metrics.sealed++;
      if (this.recorder) await this.recorder(pair, music, dj);
    });
  }
  async render() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      const now = this.now(),
        first = Math.max(0, Math.floor((now - RETAIN) / frames(SEGMENT))),
        last = Math.floor((now + LOOKAHEAD) / frames(SEGMENT));
      // On restart, retain existing markers but do not regenerate a long outage.
      for (let seq = first; seq <= last; seq++) await this.makeSegment(seq);
      for (const seq of this.sealed.keys())
        if (seq < first) this.sealed.delete(seq);
      for (const name of await readdir(join(this.data, "segments"))) {
        const seq = Number(name.slice(name.lastIndexOf("-") + 1));
        if (!name.startsWith(this.state.broadcast + "-") || seq < first)
          await rm(join(this.data, "segments", name), {
            recursive: true,
            force: true,
          });
      }
      await this.exclusive(async () => {
        this.editorial.reconcile(this.state.links, now);
        const expired = this.state.links.filter((l) => l.end < now - RETAIN);
        this.state.links = this.state.links.filter(
          (l) => l.end >= now - RETAIN,
        );
        while (
          this.state.programmes.length > 1 &&
          this.state.programmes[1].from < now - RETAIN - frames(1800)
        )
          this.state.programmes.shift();
        this.tracks = [
          ...new Map(
            this.state.programmes
              .flatMap((p) => p.tracks)
              .map((t) => [t.id, t]),
          ).values(),
        ];
        await this.persist();
        for (const link of expired) await rm(link.path, { force: true });
      });
    } catch (error) {
      this.metrics.renderFailures++;
      console.error("Playout render error:", error.message);
    } finally {
      this.rendering = false;
    }
  }
  manifest() {
    const pairs = [...this.sealed.values()].sort(
      (a, b) => a.sequence - b.sequence,
    );
    return {
      version: 2,
      broadcast: this.state.broadcast,
      epoch: this.state.epoch,
      serverTime: this.clock(),
      sampleRate: RATE,
      segmentSeconds: SEGMENT,
      latencySeconds: 12,
      firstSequence: pairs[0]?.sequence,
      lastSequence: pairs.at(-1)?.sequence,
      pairs,
      programme: programmeSlots(
        this.state.programmes,
        this.now(),
        this.now() + frames(900),
      ),
    };
  }
}
