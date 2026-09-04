import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, rename } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { processAudio } from "./audio.mjs";
import { validateCues } from "./clock.mjs";
import { trackSheet } from "./track-sheet.mjs";
import { readJSON } from "./storage.mjs";
export async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function loadCatalog(root, data) {
  const playlist = await readJSON(join(root, "tracks/playlist.json"));
  const cues = await readJSON(join(root, "station/cues.json"), {});
  const directory = join(data, "catalog");
  await mkdir(directory, { recursive: true });
  const tracks = [];
  for (const row of playlist.tracks) {
    if (
      typeof row.file !== "string" ||
      basename(row.file) !== row.file ||
      !row.title ||
      !row.artist
    )
      throw new Error("Invalid catalogue entry");
    const source = resolve(root, "tracks", row.file),
      sha256 = await hashFile(source);
    // Decode once to disk. Version this key when the decode chain changes.
    const path = join(directory, `${sha256}-pcm-v1.raw`);
    if (!(await stat(path).catch(() => null))) {
      console.log(`Preparing ${row.artist} — ${row.title}`);
      const tmp = `${path}.tmp`;
      await processAudio([
        "-y",
        "-i",
        source,
        "-vn",
        "-af",
        "loudnorm=I=-18:TP=-2:LRA=11",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-f",
        "s16le",
        tmp,
      ]);
      await rename(tmp, path);
    }
    const length = (await stat(path)).size / 4;
    if (!Number.isSafeInteger(length) || length <= 0)
      throw new Error(`Invalid decoded audio: ${row.file}`);
    const sheet = trackSheet(cues[row.file], sha256, length / 44100);
    tracks.push({
      ...row,
      id: sha256,
      sha256,
      frames: length,
      path,
      explicit: row.explicit === true || /-explicit\.mp3$/i.test(row.file),
      sheet,
      cues: validateCues(sheet, sha256, length),
    });
  }
  if (!tracks.length) throw new Error("The music catalogue is empty");
  return tracks;
}
