import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCues,
  micWindows,
  admit,
  buildCycle,
  slotsBetween,
  contextFor,
} from "../server/clock.mjs";
import { trackSheet } from "../server/track-sheet.mjs";
import { frames } from "../server/audio.mjs";
const sheet = {
  version: 1,
  sha256: "hash",
  reviewed: true,
  reviewedBy: "human",
  reviewedAt: "2026-09-01",
  ending: "cold",
  vocals: [{ start: 20, end: 40 }],
  windows: [
    { kind: "intro", start: 0, end: 15, confidence: "reviewed" },
    { kind: "outro", start: 45, end: 60, confidence: "reviewed" },
  ],
};
test("cues require exact audio, review provenance, ranges and vocal clearance", () => {
  assert.equal(validateCues(sheet, "other", frames(60)).windows.length, 0);
  assert.equal(
    validateCues({ ...sheet, reviewed: false }, "hash", frames(60)).windows
      .length,
    0,
  );
  assert.equal(
    validateCues({ ...sheet, reviewedBy: "" }, "hash", frames(60)).windows
      .length,
    0,
  );
  assert.equal(
    validateCues(
      { ...sheet, vocals: [{ start: 10, end: 25 }] },
      "hash",
      frames(60),
    ).windows.length,
    1,
  );
  assert.equal(
    validateCues(
      { ...sheet, windows: [{ start: 0, end: NaN }] },
      "hash",
      frames(60),
    ).windows.length,
    0,
  );
  assert.equal(validateCues(sheet, "hash", frames(60)).windows.length, 2);
});
test("intro, instrumental and outro windows have guards", () => {
  const t = {
    cues: validateCues(
      {
        ...sheet,
        windows: [
          ...sheet.windows,
          { kind: "instrumental", start: 16, end: 19, confidence: "reviewed" },
        ],
      },
      "hash",
      frames(60),
    ),
  };
  const result = micWindows(
    { id: "track", start: frames(100), end: frames(160), type: "track" },
    t,
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].start, frames(100.5));
  assert.equal(result[0].end, frames(114.5));
});
test("actual duration, deadlines, overlap and cadence are authoritative", () => {
  const window = { start: frames(50), end: frames(60) };
  assert.equal(admit(window, frames(10), 0, 0), true);
  for (const length of [0, NaN, -1, frames(10) + 1])
    assert.equal(admit(window, length, 0, 0), false);
  assert.equal(admit(window, frames(5), frames(27), 0), false);
  assert.equal(admit(window, frames(5), 0, frames(50)), false);
  assert.equal(admit(window, frames(5), 0, 0, [{ start: frames(20) }]), false);
});
test("committed programme repeats independently and makes truthful neighbours", () => {
  const cycle = buildCycle([
    {
      id: "a",
      title: "A",
      artist: "One",
      frames: frames(60),
      cues: { ending: "cold" },
    },
    {
      id: "b",
      title: "B",
      artist: "Two",
      frames: frames(90),
      cues: { ending: "fade" },
    },
  ]);
  const slots = slotsBetween(cycle, frames(140), frames(250));
  const junction = slots.find((s) => s.type === "junction");
  const context = contextFor(cycle, junction, micWindows(junction)[0]);
  assert.equal(context.previous.title, "B");
  assert.equal(context.next.title, "A");
  assert.equal(context.current, null);
  assert.equal(slots.find((s) => s.title === "A").start, frames(168));
});
test("word-level sheets accept backfills without granting mic authority", () => {
  const words = [{ text: "Omarchy", start: 1, end: 2 }];
  const parsed = trackSheet(
    { version: 1, sha256: "hash", lyrics: { coverage: "partial", words } },
    "hash",
    60,
  );
  assert.deepEqual(parsed.lyrics.words, words);
  assert.equal(validateCues(parsed, "hash", frames(60)).windows.length, 0);
  assert.equal(
    trackSheet(
      { ...sheet, lyrics: { words: [{ text: "bad", start: 5, end: 3 }] } },
      "hash",
      60,
    ).reviewed,
    false,
  );
  assert.equal(trackSheet(sheet, "new-hash", 60).reviewed, false);
});

test("timestamped words close a conflicting reviewed mic window", () => {
  const words = [{ text: "vocal", start: 3, end: 4 }];
  const parsed = trackSheet(
    { ...sheet, lyrics: { coverage: "partial", words } },
    "hash",
    60,
  );
  assert.equal(validateCues(parsed, "hash", frames(60)).windows.length, 1);
});
test("programme proposal must preserve the entire repository catalogue", async () => {
  const { orderTracks, proposeProgramme } = await import(
    "../server/planner.mjs"
  );
  const tracks = [
    { id: "a", sheet: { metadata: {} } },
    { id: "b", sheet: { metadata: {} } },
  ];
  assert.throws(() => orderTracks(tracks, { version: 1, order: ["a", "a"] }));
  assert.throws(() =>
    orderTracks(tracks, { version: 1, order: ["a", "new-song"] }),
  );
  const plan = await proposeProgramme(tracks, async () => ({
    order: ["b", "a"],
  }));
  assert.deepEqual(
    orderTracks(tracks, plan).map((t) => t.id),
    ["b", "a"],
  );
});
