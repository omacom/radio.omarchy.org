import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stationServer } from "../server/http.mjs";
import { Listeners } from "../server/listeners.mjs";
import { icyBlock } from "../server/legacy.mjs";
import {
  programme,
  scheduleUpdate,
  programmeSlots,
} from "../server/programme.mjs";
import { frames } from "../server/audio.mjs";
import { Demo } from "../server/demo.mjs";
const track = (id) => ({
  id,
  title: id,
  artist: "Artist",
  frames: frames(60),
  cues: { windows: [], ending: "cold" },
});
test("catalogue additions take effect beyond the committed horizon at a rotation boundary", () => {
  const history = [programme([track("a"), track("b")])],
    before = programmeSlots(history, 0, frames(900));
  assert.equal(
    scheduleUpdate(history, [track("a"), track("b"), track("c")], frames(10)),
    true,
  );
  assert.deepEqual(programmeSlots(history, 0, frames(900)), before);
  const boundary = history[1].from;
  assert.ok(boundary >= frames(1810));
  assert.equal(boundary % history[0].cycle.at(-1).end, 0);
  assert.equal(programmeSlots(history, boundary, boundary + 1)[0].trackId, "a");
  assert.equal(
    scheduleUpdate(history, [track("a"), track("b"), track("c")], frames(20)),
    false,
  );
});
test("split-host public API supports approved origin and rejects other preflights", async (t) => {
  const station = { manifest: () => ({ version: 2 }), state: {}, metrics: {} };
  const server = stationServer(station, process.cwd(), {
    origins: ["https://radio.omarchy.org"],
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}/api/station`;
  let response = await fetch(url, {
    headers: { origin: "https://radio.omarchy.org" },
  });
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://radio.omarchy.org",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  response = await fetch(url, {
    method: "OPTIONS",
    headers: { origin: "https://other.example" },
  });
  assert.equal(response.status, 403);
  response = await fetch(url, {
    method: "OPTIONS",
    headers: { origin: "https://radio.omarchy.org" },
  });
  assert.equal(response.status, 204);
});
test("listener statistics count sessions, expire inactivity and retain aggregate history", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "radio-stats-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  let now = 100000;
  const stats = new Listeners(join(path, "stats.json"), () => now);
  await stats.restore();
  stats.touch("listener-1");
  now += 10000;
  stats.touch("listener-1");
  stats.touch("listener-2");
  assert.equal(stats.snapshot().total_sessions, 2);
  assert.equal(stats.snapshot().active_listeners, 2);
  assert.ok(stats.snapshot().total_listen_hours > 0);
  now += 31000;
  assert.equal(stats.snapshot().active_listeners, 0);
  await stats.save();
  const restored = new Listeners(join(path, "stats.json"));
  await restored.restore();
  assert.equal(restored.snapshot().total_sessions, 2);
});
test("ICY metadata uses bounded 16-byte blocks and cannot inject stream fields", () => {
  const block = icyBlock("Artist'; hacked='value");
  assert.equal(block.length, 1 + block[0] * 16);
  assert.ok(!block.toString().includes("hacked='"));
  assert.equal(icyBlock("A".repeat(10000)).length <= 4097, true);
});
test("demo arrivals are clocked, exactly once and use the real editorial ingestion seam", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "radio-demo-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  let at = 0;
  const rows = [];
  const d = new Demo(
    {
      referenceTime: "2026-09-04T21:00:00Z",
      arrivals: [{ id: "a", at: 5, story: { title: "A" } }],
    },
    path,
  );
  await d.initialize();
  d.attach({
    now: () => frames(at),
    editorial: { ingest: (r) => rows.push(...r) },
  });
  await d.arrivals();
  assert.equal(rows.length, 0);
  at = 5;
  await d.arrivals();
  await d.arrivals();
  assert.equal(rows.length, 1);
  assert.equal(d.station.editorial.clock(), Date.parse("2026-09-04T21:00:05Z"));
});

test(
  "conventional clients receive decodable MP3 and ICY from one station encoder",
  { timeout: 10000 },
  async (t) => {
    const { LegacyStream } = await import("../server/legacy.mjs");
    const { processAudio, RATE } = await import("../server/audio.mjs");
    const began = Date.now(),
      rotation = programme([track("Shared record")]);
    const station = {
      now: () => frames(12 + (Date.now() - began) / 1000),
      state: { programmes: [rotation], links: [] },
      pcm: async (start, end) => {
        const music = Buffer.alloc((end - start) * 4);
        for (let f = 0; f < end - start; f++)
          for (let c = 0; c < 2; c++)
            music.writeInt16LE(
              Math.round(Math.sin(((start + f) * Math.PI * 880) / RATE) * 3000),
              f * 4 + c * 2,
            );
        return { music, dj: Buffer.alloc(music.length) };
      },
    };
    const legacy = new LegacyStream(station);
    legacy.start();
    const server = stationServer(station, process.cwd(), { legacy });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    t.after(() => {
      legacy.stop();
      server.closeAllConnections();
      server.close();
    });
    const url = `http://127.0.0.1:${server.address().port}/omarchy/stream`;
    const response = await fetch(url, {
      headers: { "icy-metadata": "1" },
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(response.headers.get("icy-br"), "128");
    assert.equal(response.headers.get("icy-metaint"), "8192");
    const reader = response.body.getReader();
    let bytes = Buffer.alloc(0);
    while (bytes.length < 10000) {
      const { done, value } = await reader.read();
      assert.equal(done, false);
      bytes = Buffer.concat([bytes, value]);
    }
    await reader.cancel();
    const metadata = bytes.subarray(8193, 8193 + bytes[8192] * 16).toString();
    assert.match(metadata, /Shared record/);
    const decoded = await processAudio(
      [
        "-f",
        "mp3",
        "-i",
        "pipe:0",
        "-f",
        "s16le",
        "-ar",
        String(RATE),
        "-ac",
        "2",
        "pipe:1",
      ],
      bytes.subarray(0, 8192),
    );
    assert.ok(decoded.length > RATE);
  },
);
