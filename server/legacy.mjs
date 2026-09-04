import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { RATE, frames } from "./audio.mjs";
import { duckLevel } from "../assets/js/station-player.js";
import { programmeSlots } from "./programme.mjs";
const METAINT = 8192;
export function icyBlock(title) {
  const text = Buffer.from(
    `StreamTitle='${title.replace(/[\x00-\x1f';]/g, " ").slice(0, 400)}';`,
  );
  const size = Math.ceil(text.length / 16),
    result = Buffer.alloc(1 + size * 16);
  result[0] = size;
  text.copy(result, 1);
  return result;
}
// A single continuous encoder, owned by the station, not by each listener.
export class LegacyStream {
  constructor(station, listeners) {
    this.station = station;
    this.listeners = listeners;
    this.clients = new Set();
    this.busy = false;
    this.next = null;
    this.title = "Omarchy Radio";
  }
  start() {
    this.launch();
    this.timer = setInterval(() => void this.pump(), 100);
  }
  launch() {
    this.encoder = spawn(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "s16le",
        "-ar",
        String(RATE),
        "-ac",
        "2",
        "-i",
        "pipe:0",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-reservoir",
        "0",
        "-write_xing",
        "0",
        "-id3v2_version",
        "0",
        "-flush_packets",
        "1",
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    this.encoder.stdin.on("error", () => {});
    this.encoder.stdout.on("data", (chunk) => this.publish(chunk));
    this.encoder.on("error", () => {});
    this.encoder.on("exit", () => {
      if (!this.stopped) {
        for (const c of this.clients) c.res.destroy();
        this.clients.clear();
        this.next = null;
        this.restart = setTimeout(() => this.launch(), 1000);
      }
    });
  }
  async pump() {
    if (this.busy || !this.encoder?.stdin.writable || this.stopped) return;
    this.busy = true;
    try {
      const target = Math.max(0, this.station.now() - frames(12));
      if (this.next === null) this.next = Math.floor(target / 1152) * 1152;
      // Slow encoder or suspended host: reset the conventional stream, rather
      // than slowly replay an obsolete show. The paired transport is unaffected.
      if (target - this.next > frames(3)) {
        this.terminate();
        return;
      }
      const count = Math.floor((target - this.next) / 1152) * 1152;
      if (count <= 0) return;
      const start = this.next,
        end = start + count;
      const { music, dj } = await this.station.pcm(start, end),
        mixed = Buffer.alloc(music.length);
      const links =
        this.station.presentation?.(start - frames(0.45), end + frames(0.12)) ??
        this.station.state.links;
      for (let i = 0; i < count; i++) {
        const gain = duckLevel(links, (start + i) / RATE);
        for (let c = 0; c < 2; c++) {
          const at = i * 4 + c * 2;
          mixed.writeInt16LE(
            Math.max(
              -32768,
              Math.min(
                32767,
                Math.round(music.readInt16LE(at) * gain + dj.readInt16LE(at)),
              ),
            ),
            at,
          );
        }
      }
      const slot = programmeSlots(this.station.state.programmes, start, end).at(
        -1,
      );
      if (slot)
        this.title = `${slot.title} — ${slot.artist}${slot.explicit ? " [explicit]" : ""}`;
      this.next = end;
      await new Promise((resolve, reject) =>
        this.encoder.stdin.write(mixed, (error) =>
          error ? reject(error) : resolve(),
        ),
      );
      for (const c of this.clients) this.listeners?.touch(c.id);
    } catch {
      this.terminate();
    } finally {
      this.busy = false;
    }
  }
  add(req, res) {
    const client = {
      res,
      id: randomUUID(),
      metadata: req.headers["icy-metadata"] === "1",
      remaining: METAINT,
    };
    res.writeHead(200, {
      "content-type": "audio/mpeg",
      "cache-control": "no-store",
      "icy-name": "Omarchy",
      "icy-genre": "Electronic",
      "icy-br": "128",
      "icy-sr": String(RATE),
      "x-accel-buffering": "no",
      ...(client.metadata ? { "icy-metaint": String(METAINT) } : {}),
    });
    res.flushHeaders();
    this.clients.add(client);
    this.listeners?.touch(client.id);
    res.on("close", () => this.clients.delete(client));
  }
  publish(chunk) {
    for (const client of this.clients) {
      if (client.res.writableLength > 128000) {
        client.res.destroy();
        continue;
      }
      if (!client.metadata) {
        client.res.write(chunk);
        continue;
      }
      let offset = 0;
      while (offset < chunk.length) {
        const size = Math.min(client.remaining, chunk.length - offset);
        client.res.write(chunk.subarray(offset, offset + size));
        offset += size;
        client.remaining -= size;
        if (!client.remaining) {
          client.res.write(icyBlock(this.title));
          client.remaining = METAINT;
        }
      }
    }
  }
  terminate() {
    const encoder = this.encoder;
    if (!encoder) return;
    encoder.stdin.destroy();
    encoder.kill("SIGTERM");
    const deadline = setTimeout(() => encoder.kill("SIGKILL"), 1000);
    deadline.unref();
    encoder.once("close", () => clearTimeout(deadline));
  }
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.restart);
    this.terminate();
    for (const c of this.clients) c.res.destroy();
    this.clients.clear();
  }
}
