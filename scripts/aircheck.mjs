import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { processAudio, RATE, encode, decodeMP3 } from "../server/audio.mjs";
import { duckLevel } from "../assets/js/station-player.js";
const base = process.env.RADIO_URL ?? "http://127.0.0.1:8787";
const count = Math.max(
  1,
  Math.min(300, Math.ceil(Number(process.env.AIRCHECK_SECONDS ?? 24) / 4)),
);
const output = process.env.AIRCHECK_DIR ?? `var/airchecks/${Date.now()}`;
await mkdir(output, { recursive: true });
const music = [],
  dj = [],
  mixed = [],
  metadata = [];
let identity, sequence;
for (let i = 0; i < count; ) {
  const response = await fetch(`${base}/api/station`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Station unavailable");
  const manifest = await response.json();
  identity ??= manifest.broadcast;
  if (identity !== manifest.broadcast)
    throw new Error("Broadcast changed during aircheck");
  sequence ??= Math.max(
    manifest.firstSequence,
    Math.floor(((manifest.serverTime - manifest.epoch) / 1000 - 12) / 4),
  );
  const pair = manifest.pairs.find((p) => p.sequence === sequence);
  if (!pair) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    continue;
  }
  const pcm = await Promise.all(
    ["music", "dj"].map(async (stem) => {
      const response = await fetch(new URL(pair.stems[stem].url, base), {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`Missing ${stem}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        pair.stems[stem].sha256
      )
        throw new Error("Hash mismatch");
      const decoded = await decodeMP3(bytes);
      if (decoded.length !== pair.decodedFrames * 4)
        throw new Error("MP3 padding mismatch");
      const audio = decoded.subarray(
        pair.trimStart * 4,
        (pair.trimStart + pair.frames) * 4,
      );
      if (audio.length !== pair.frames * 4)
        throw new Error("Stem frame mismatch");
      return audio;
    }),
  );
  music.push(pcm[0]);
  dj.push(pcm[1]);
  const mix = Buffer.alloc(pcm[0].length);
  const links = manifest.pairs.flatMap((p) => p.links);
  for (let frame = 0; frame < pair.frames; frame++)
    for (let channel = 0; channel < 2; channel++) {
      const offset = frame * 4 + channel * 2,
        gain = duckLevel(links, (pair.startFrame + frame) / RATE);
      mix.writeInt16LE(
        Math.max(
          -32768,
          Math.min(
            32767,
            Math.round(
              pcm[0].readInt16LE(offset) * gain + pcm[1].readInt16LE(offset),
            ),
          ),
        ),
        offset,
      );
    }
  mixed.push(mix);
  metadata.push(pair);
  sequence++;
  i++;
}
for (const [name, parts] of [
  ["music", music],
  ["dj", dj],
  ["mix", mixed],
])
  await writeFile(
    join(output, `${name}.mp3`),
    await encode(Buffer.concat(parts)),
  );
await writeFile(
  join(output, "metadata.json"),
  JSON.stringify(metadata, null, 2),
);
console.log(`Verified ${count * 4}s of paired audio. Aircheck: ${output}`);
