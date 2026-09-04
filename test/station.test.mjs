import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Station } from "../server/station.mjs";
import { frames, encode, processAudio, decodeMP3 } from "../server/audio.mjs";
import { stationServer } from "../server/http.mjs";
async function fixture(t, options = {}) {
  const data = await mkdtemp(join(tmpdir(), "radio-test-"));
  t.after(() => rm(data, { recursive: true, force: true }));
  const path = join(data, "track.raw");
  await writeFile(path, Buffer.alloc(frames(60) * 4, 32));
  const tracks = [
    {
      id: "a",
      title: "A",
      artist: "Artist",
      explicit: true,
      frames: frames(60),
      path,
      cues: { windows: [], ending: "cold" },
      sheet: {},
    },
  ];
  let now = 1000000;
  const station = new Station(tracks, data, process.cwd(), {
    clock: () => now,
    encode: async (pcm) => pcm,
    tools: {},
    model: async () => {
      throw new Error("provider unavailable");
    },
    ...options,
  });
  await station.initialize();
  return {
    station,
    data,
    tracks,
    advance: (ms) => {
      now += ms;
    },
  };
}
test("vertical slice seals distinct aligned stems, measures speech and survives restart", async (t) => {
  const { station: s, data, tracks, advance } = await fixture(t);
  assert.equal(
    await s.commit(
      { start: frames(60.5), end: frames(77.5) },
      "Ident",
      Buffer.alloc(frames(3) * 4, 12),
    ),
    true,
  );
  advance(50000);
  await s.render();
  const pair = s.manifest().pairs.find((p) => p.sequence === 15);
  assert.equal(pair.links[0].text, "Ident");
  assert.equal(pair.frames, frames(4));
  const directory = join(data, "segments", `${s.state.broadcast}-15`);
  assert.notDeepEqual(
    await readFile(join(directory, "music.mp3")),
    await readFile(join(directory, "dj.mp3")),
  );
  const original = await readFile(join(directory, "dj.mp3"));
  assert.equal(
    await s.commit(
      { start: frames(60.5), end: frames(77.5) },
      "Late",
      Buffer.alloc(400),
    ),
    false,
  );
  await s.makeSegment(15);
  assert.deepEqual(await readFile(join(directory, "dj.mp3")), original);
  const restored = new Station(tracks, data, process.cwd(), {
    clock: () => 1050000,
    encode: async (p) => p,
    tools: {},
  });
  await restored.initialize();
  assert.equal(restored.state.epoch, s.state.epoch);
  assert.equal(restored.state.broadcast, s.state.broadcast);
  assert.deepEqual(
    restored.manifest().pairs.find((p) => p.sequence === 15),
    pair,
  );
});
test("TTS failure and overrun leave music available", async (t) => {
  const { station: s } = await fixture(t, {
    voice: async () => {
      throw new Error("TTS offline");
    },
  });
  await s.prepare();
  assert.equal(s.state.links.length, 0);
  assert.ok(s.metrics.editorialFailures > 0);
  assert.equal(
    await s.commit(
      { start: frames(60.5), end: frames(77.5) },
      "too long",
      Buffer.alloc(frames(18) * 4),
    ),
    false,
  );
  assert.ok(s.manifest().pairs.length > 0);
});
test("paired publication is atomic on encoder failure and retries", async (t) => {
  const { station: s, data } = await fixture(t);
  let n = 0;
  s.encoder = async (p) => {
    if (++n === 2) throw new Error("encoder failed");
    return p;
  };
  await assert.rejects(s.makeSegment(8));
  assert.equal(s.sealed.has(8), false);
  await assert.rejects(
    readFile(join(data, "segments", `${s.state.broadcast}-8`, "pair.json")),
  );
  s.encoder = async (p) => p;
  await s.makeSegment(8);
  assert.equal(s.sealed.has(8), true);
});
test("disk ring is bounded through long outage, clock continues", async (t) => {
  const { station: s, advance } = await fixture(t);
  advance(3600000);
  await s.render();
  assert.ok(s.manifest().pairs.length <= 37);
  assert.ok(s.manifest().firstSequence >= 870);
  assert.equal(s.now(), frames(3600));
});
test("HTTP exposes only sealed audio and public assets with range support", async (t) => {
  const { station: s } = await fixture(t);
  const server = stationServer(s, process.cwd());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of [
    "/server/station.mjs",
    "/.env",
    "/var/station.json",
    "/api/ops",
  ])
    assert.ok((await fetch(base + path)).status >= 400);
  assert.equal(
    (await fetch(base + "/api/station")).headers.get("cache-control"),
    "no-store",
  );
  assert.equal(
    (await fetch(base + `/api/audio/${s.state.broadcast}/999/music.mp3`))
      .status,
    404,
  );
  const file = "/tracks/" + encodeURIComponent("Cam - Omarchy!.mp3");
  const response = await fetch(base + file, {
    headers: { range: "bytes=10-19" },
  });
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 10);
  assert.equal(
    (await fetch(base + file, { headers: { range: "bytes=99-1" } })).status,
    416,
  );
});
test("MP3 gapless metadata preserves PCM frame count and waveform timing", async () => {
  const pcm = Buffer.alloc(frames(4) * 4);
  for (let i = 0; i < pcm.length / 2; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 31) * 12000), i * 2);
  const compressed = await encode(pcm);
  const decoded = await decodeMP3(compressed);
  assert.equal(decoded.length, pcm.length);
  let dot = 0,
    sourcePower = 0,
    decodedPower = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const a = pcm.readInt16LE(i),
      b = decoded.readInt16LE(i);
    dot += a * b;
    sourcePower += a * a;
    decodedPower += b * b;
  }
  assert.ok(dot / Math.sqrt(sourcePower * decodedPower) > 0.99);
  assert.ok(compressed.length < pcm.length / 5);
});

test("a deliberate presenter decline stays quiet even in a junction", async (t) => {
  let rendered = 0;
  const { station: s } = await fixture(t, {
    model: async () => ({ text: "", factIds: [] }),
    voice: async () => {
      rendered++;
      throw new Error("must not render");
    },
  });
  await s.prepare();
  assert.equal(rendered, 0);
  assert.equal(s.state.links.length, 0);
});
test("editorial recovery reconstructs scheduled stories from committed links", async (t) => {
  const { station: s, data, tracks } = await fixture(t);
  const source = {
    id: "story",
    title: "Story",
    author: "Source",
    url: "https://example.com/story",
    publishedAt: "2026-09-04",
    retrievedAt: "2026-09-04",
  };
  s.state.editorial.stories.push(source);
  await s.commit(
    { start: frames(60.5), end: frames(77.5) },
    "News",
    Buffer.alloc(frames(2) * 4),
    { source },
  );
  delete source.scheduled;
  await s.persist();
  const restored = new Station(tracks, data, process.cwd(), {
    clock: () => 1064000,
    encode: async (p) => p,
    tools: {},
  });
  await restored.initialize();
  assert.ok(restored.state.editorial.aired.includes("story"));
});
test("local TTS vertical slice has measured speech, committed provenance and paired MP3", async (t) => {
  const { spawnSync } = await import("node:child_process");
  if (spawnSync("espeak-ng", ["--version"]).status !== 0) {
    t.skip("espeak-ng unavailable");
    return;
  }
  const { renderVoice } = await import("../server/providers.mjs");
  const prior = process.env.TTS_PROVIDER;
  process.env.TTS_PROVIDER = "local";
  t.after(() => {
    if (prior === undefined) delete process.env.TTS_PROVIDER;
    else process.env.TTS_PROVIDER = prior;
  });
  const {
    station: s,
    advance,
    data,
  } = await fixture(t, { voice: renderVoice, encode });
  await s.prepare();
  assert.equal(s.state.links.length, 1);
  const link = s.state.links[0];
  assert.ok(link.end - link.start > frames(1));
  assert.ok(link.end <= frames(77.5));
  advance(60000);
  await s.render();
  const pair = s.manifest().pairs.find((p) => p.sequence === 15);
  assert.equal(
    pair.links[0].text,
    "Omarchy Radio. Music made by the community.",
  );
  const bytes = await readFile(
    join(data, "segments", `${s.state.broadcast}-15`, "dj.mp3"),
  );
  const pcm = await decodeMP3(bytes);
  assert.equal(pcm.length, (frames(4) + 4608) * 4);
  assert.ok(pcm.some((b) => b !== 0));
});

test("prerecorded idents reserve their own time and longer beds preserve the committed clock", async (t) => {
  const { station: s, data, tracks } = await fixture(t);
  const { programme } = await import("../server/programme.mjs");
  const { micWindows } = await import("../server/clock.mjs");
  const make = async (name, seconds, value) => {
    const path = join(data, name);
    await writeFile(path, Buffer.alloc(frames(seconds) * 4, value));
    return { path, frames: frames(seconds), sha256: name };
  };
  const sting = await make("sting.raw", 5, 1),
    bed = await make("bed.raw", 30, 2),
    ident = await make("ident.raw", 2, 3);
  tracks[0].furniture = {
    id: "furniture",
    sting,
    bed,
    idents: [{ ...ident, text: "Station ident" }],
    frames: frames(35),
    micStart: frames(5),
    micEnd: frames(35),
  };
  s.state.programmes = [programme(tracks)];
  const junction = s.state.programmes[0].cycle[1],
    window = micWindows(junction)[0];
  assert.equal(window.start, frames(65.5));
  assert.equal(window.end, frames(94.5));
  assert.equal(junction.end, frames(95));
  assert.equal(
    await s.commit(
      window,
      "A longer grounded link",
      Buffer.alloc(frames(20) * 4, 4),
    ),
    true,
  );
  const pcm = await s.pcm(frames(60), frames(70));
  assert.equal(pcm.dj[0], 0);
  assert.equal(pcm.dj[frames(0.2) * 4], 3);
  assert.equal(pcm.dj[frames(3) * 4], 0);
  assert.equal(pcm.dj[frames(6) * 4], 4);
  assert.equal(pcm.music[0], 1);
  assert.equal(pcm.music[frames(6) * 4], 2);
  await s.makeSegment(15);
  const pair = s.manifest().pairs.find((p) => p.sequence === 15);
  assert.equal(pair.links[0].prerecorded, true);
  assert.equal(JSON.stringify(pair).includes(data), false);
});
