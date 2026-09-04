import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { RATE, MP3_GUARD } from "./audio.mjs";
import { model } from "./providers.mjs";
import { duckLevel } from "../assets/js/station-player.js";
export class Demo {
  constructor(scenario, directory) {
    this.scenario = scenario;
    this.directory = directory;
    this.delivered = new Set();
    this.queue = Promise.resolve();
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true });
  }
  attach(station) {
    this.station = station;
    station.editorial.clock = () =>
      Date.parse(this.scenario.referenceTime) + (station.now() / RATE) * 1000;
  }
  event(type, details = {}) {
    const event = {
      type,
      frame: this.station?.now() ?? 0,
      wallTime: new Date().toISOString(),
      ...details,
    };
    this.queue = this.queue.then(() =>
      appendFile(
        join(this.directory, "events.jsonl"),
        JSON.stringify(event) + "\n",
      ),
    );
    return this.queue;
  }
  async arrivals() {
    for (const arrival of this.scenario.arrivals)
      if (
        !this.delivered.has(arrival.id) &&
        arrival.at <= this.station.now() / RATE
      ) {
        this.station.editorial.ingest([arrival.story]);
        this.delivered.add(arrival.id);
        await this.event("source_arrived", {
          arrival: arrival.id,
          source: arrival.story,
        });
      }
  }
  async call(role, policy, input, properties) {
    const started = Date.now();
    await this.event("model_started", { role });
    try {
      const result = await model(role, policy, input, properties);
      await this.event("model_completed", {
        role,
        result,
        milliseconds: Date.now() - started,
      });
      return result;
    } catch (error) {
      await this.event("model_failed", { role, error: error.message });
      throw error;
    }
  }
  async record(pair, music, dj) {
    if (pair.startFrame >= (this.scenario.duration ?? 1800) * RATE) return;
    music = music.subarray(MP3_GUARD * 4, (MP3_GUARD + pair.frames) * 4);
    dj = dj.subarray(MP3_GUARD * 4, (MP3_GUARD + pair.frames) * 4);
    const mix = Buffer.alloc(music.length);
    for (let frame = 0; frame < pair.frames; frame++) {
      const gain = duckLevel(pair.links, (pair.startFrame + frame) / RATE);
      for (let c = 0; c < 2; c++) {
        const at = frame * 4 + c * 2;
        mix.writeInt16LE(
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
    for (const [name, buffer] of [
      ["music", music],
      ["dj", dj],
      ["mix", mix],
    ])
      await appendFile(join(this.directory, `${name}.s16le`), buffer);
    await appendFile(
      join(this.directory, "pairs.jsonl"),
      JSON.stringify(pair) + "\n",
    );
  }
}
