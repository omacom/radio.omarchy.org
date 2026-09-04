import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  RadioPlayer,
  joinPosition,
  duckLevel,
} from "../assets/js/station-player.js";
class Param {
  value = 1;
  events = [];
  cancelScheduledValues(t) {
    this.events = this.events.filter((e) => e[2] < t);
  }
  setValueAtTime(v, t) {
    this.value = v;
    this.events.push(["set", v, t]);
  }
  setTargetAtTime(v, t) {
    this.value = v;
    this.events.push(["target", v, t]);
  }
  linearRampToValueAtTime(v, t) {
    this.events.push(["ramp", v, t]);
  }
}
class Node {
  gain = new Param();
  connect() {}
  disconnect() {}
  start(...args) {
    this.started = args;
  }
  stop() {
    this.stopped = true;
  }
}
class Context {
  currentTime = 0;
  state = "running";
  sampleRate = 44100;
  destination = {};
  sources = [];
  createGain() {
    return new Node();
  }
  createAnalyser() {
    return new Node();
  }
  createBufferSource() {
    const node = new Node();
    this.sources.push(node);
    return node;
  }
  async resume() {
    this.state = "running";
  }
  async close() {
    this.state = "closed";
  }
  createBuffer(channels, length, rate) {
    return {
      duration: length / rate,
      numberOfChannels: channels,
      copyToChannel() {},
    };
  }
  async decodeAudioData() {
    return {
      duration: 4 + 4608 / 44100,
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(4 * 44100 + 4608),
    };
  }
}
function setup(t) {
  const bytes = Buffer.from("audio"),
    hash = createHash("sha256").update(bytes).digest("hex");
  const link = { id: "link", start: 13 * 44100, end: 18 * 44100 };
  const manifest = {
    version: 2,
    broadcast: "one",
    sampleRate: 44100,
    epoch: 0,
    serverTime: 24000,
    latencySeconds: 12,
    firstSequence: 0,
    lastSequence: 32,
    segmentSeconds: 4,
    pairs: Array.from({ length: 33 }, (_, sequence) => ({
      broadcast: "one",
      sequence,
      startFrame: sequence * 4 * 44100,
      frames: 4 * 44100,
      codec: "mp3",
      trimStart: 2304,
      decodedFrames: 4 * 44100 + 4608,
      stems: {
        music: { url: `/music/${sequence}`, sha256: hash },
        dj: { url: `/dj/${sequence}`, sha256: hash },
      },
      slots: [{ id: "track", start: 0, end: 100 * 44100 }],
      links: sequence === 3 || sequence === 4 ? [link] : [],
    })),
  };
  const control = {
    failDJ: false,
    failMusic: false,
    corrupt: false,
    delay: null,
  };
  const fetcher = async (url) => {
    if (url.startsWith("/api/station?"))
      return { ok: true, json: async () => structuredClone(manifest) };
    if (control.delay) await control.delay;
    if (control.failMusic && url.startsWith("/music"))
      throw new Error("offline");
    if (control.failDJ && url.startsWith("/dj"))
      throw new Error("voice offline");
    const data = control.corrupt ? Buffer.from("bad") : bytes;
    return {
      ok: true,
      arrayBuffer: async () =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    };
  };
  const player = new RadioPlayer({ fetcher, AudioContextClass: Context });
  t.after(() => player.stop());
  return { player, manifest, control };
}
test("join uses the server clock and two stems start at the exact same offset", async (t) => {
  const { player: p, manifest: m } = setup(t);
  assert.equal(joinPosition(m), 12);
  await p.start();
  assert.ok(p.pairs.length >= 4);
  for (const pair of p.pairs)
    assert.deepEqual(pair.music.started, pair.dj.started);
  assert.ok(Math.abs(p.position - 11.85) < 0.02);
});
test("DJ mute cancels pending ducking and never seeks or restarts music", async (t) => {
  const { player: p } = setup(t);
  await p.start();
  p.context.currentTime = p.anchor + 14;
  const sources = [...p.context.sources],
    position = p.position;
  p.setDJ(false);
  assert.equal(p.voice.gain.value, 0);
  assert.equal(p.pairs[0].gain.gain.value, 1);
  assert.equal(p.position, position);
  assert.deepEqual(p.context.sources, sources);
  p.setDJ(true);
  assert.equal(p.pairs[0].gain.gain.value, 0.24);
  assert.equal(p.position, position);
});
test("duck envelope guards speech and recovers cleanly across segment boundaries", () => {
  const links = [{ start: 10 * 44100, end: 12 * 44100 }];
  assert.equal(duckLevel(links, 9), 1);
  assert.ok(duckLevel(links, 9.94) < 1);
  assert.equal(duckLevel(links, 11), 0.24);
  assert.ok(duckLevel(links, 12.2) > 0.24);
  assert.equal(duckLevel(links, 12.5), 1);
});
test("DJ transport failure leaves music unducked on its original timeline", async (t) => {
  const { player: p, control } = setup(t);
  control.failDJ = true;
  await p.start();
  assert.ok(p.pairs.length);
  for (const pair of p.pairs) {
    assert.equal(pair.dj, undefined);
    assert.equal(pair.gain.gain.value, 1);
  }
});
test("reconnect and suspension discard stale buffers and rejoin both stems together", async (t) => {
  const { player: p, manifest: m, control } = setup(t);
  await p.start();
  const old = p.pairs[0];
  control.failMusic = true;
  p.context.currentTime = 25;
  m.serverTime = 60000;
  await p.fill();
  assert.equal(old.music.stopped, true);
  control.failMusic = false;
  await p.fill();
  assert.ok(Math.abs(p.position - 47.85) < 0.02);
  for (const pair of p.pairs)
    assert.deepEqual(pair.music.started, pair.dj.started);
  m.serverTime = 64000;
  p.context.state = "suspended";
  await p.resume();
  assert.ok(Math.abs(p.position - 51.85) < 0.02);
});
test("new broadcast identity never mixes old audio or metadata", async (t) => {
  const { player: p, manifest: m } = setup(t);
  await p.start();
  const old = p.pairs[0];
  m.broadcast = "two";
  for (const pair of m.pairs) pair.broadcast = "two";
  await p.fill();
  assert.equal(old.music.stopped, true);
  assert.equal(p.broadcast, "two");
});
test("stop during in-flight fetch cannot schedule audio afterward", async (t) => {
  const { player: p, control } = setup(t);
  let release;
  control.delay = new Promise((resolve) => {
    release = resolve;
  });
  const pending = p.start();
  await new Promise((resolve) => setImmediate(resolve));
  const ctx = p.context;
  p.stop();
  release();
  await pending;
  assert.equal(ctx.sources.length, 0);
  assert.equal(p.running, false);
});
test("corrupt or wrong-duration audio is rejected before mixing", async (t) => {
  const { player: p, control } = setup(t);
  control.corrupt = true;
  await p.start();
  assert.equal(p.pairs.length, 0);
  control.corrupt = false;
  p.context.decodeAudioData = async () => ({
    duration: 3.9,
    numberOfChannels: 2,
  });
  await p.fill();
  assert.equal(p.pairs.length, 0);
});

test("native fetch adapter is called without a RadioPlayer receiver", async (t) => {
  let receiver = "unset";
  const p = new RadioPlayer({
    AudioContextClass: Context,
    fetcher: function () {
      receiver = this;
      throw new Error("intentional");
    },
  });
  t.after(() => p.stop());
  await p.start();
  assert.equal(receiver, undefined);
});
