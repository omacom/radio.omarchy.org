import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
const playlist = JSON.parse(
  await readFile(process.env.PLAYLIST_PATH ?? "tracks/playlist.json", "utf8"),
);
const reports = {};
for (const row of playlist.tracks) {
  if (basename(row.file) !== row.file)
    throw new Error("Invalid playlist filename");
  const file = resolve(process.env.TRACKS_DIR ?? "tracks", row.file);
  if (!existsSync(file)) continue;
  const probe = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "json", file],
    { encoding: "utf8" },
  );
  if (probe.status !== 0) throw new Error(probe.stderr);
  const duration = Number(JSON.parse(probe.stdout).format.duration);
  const scan = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      "silencedetect=noise=-45dB:d=0.15,ebur128=peak=true",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (scan.status !== 0) throw new Error(scan.stderr);
  const silence = [
    ...scan.stderr.matchAll(/silence_(start|end): ([\d.]+)/g),
  ].map((m) => ({ edge: m[1], seconds: Number(m[2]) }));
  reports[row.file] = {
    sha256: createHash("sha256")
      .update(await readFile(file))
      .digest("hex"),
    version: 1,
    duration,
    metadata: { facts: [], pronunciation: "" },
    lyrics: { coverage: "unknown", words: [] },
    sections: [],
    windows: [],
    vocals: [],
    reviewed: false,
    ending: "unknown",
    silence,
    loudnessSummary: scan.stderr.slice(scan.stderr.lastIndexOf("Summary:")),
    note: "Silence does not prove the absence of vocals. Listen before setting and approving a mic window.",
  };
  console.log(`Analyzed ${row.file}`);
}
await mkdir("station", { recursive: true });
await writeFile(
  "station/analysis.json",
  JSON.stringify(reports, null, 2) + "\n",
);
console.log(
  "Wrote station/analysis.json. Approved cue sheets belong in station/cues.json.",
);
