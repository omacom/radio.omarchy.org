import { spawn } from "node:child_process";
import { open, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const RATE = 44100;
export const SEGMENT = 4;
export const FRAME_BYTES = 4;
export const MP3_GUARD = 2304; // Two MPEG frames of real context on each side.
export const frames = (seconds) => Math.round(seconds * RATE);

export function processAudio(args, input, maxBytes = RATE * 4 * 90) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-nostdin", "-v", "error", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const chunks = [];
    let size = 0,
      error = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 90000);
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > maxBytes) child.kill("SIGKILL");
      else chunks.push(b);
    });
    child.stderr.on("data", (b) => {
      error = (error + b).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`Audio process failed: ${error}`));
    });
    child.stdin.end(input);
  });
}
export const decodeVoice = (path) =>
  processAudio([
    "-i",
    path,
    "-vn",
    "-af",
    "loudnorm=I=-18:TP=-2:LRA=7",
    "-ar",
    String(RATE),
    "-ac",
    "2",
    "-f",
    "s16le",
    "pipe:1",
  ]);
// A seekable MP3 contains the Xing/LAME delay and padding fields. Pipe output
// cannot finalize those fields and is not suitable for paired browser segments.
export async function encode(pcm) {
  const directory = await mkdtemp(join(tmpdir(), "omarchy-mp3-"));
  try {
    const path = join(directory, "audio.mp3");
    await processAudio(
      [
        "-y",
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
        "-write_xing",
        "1",
        path,
      ],
      pcm,
    );
    return await readFile(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
export async function copyFileWindow(target, path, assetStart, start, end) {
  const from = Math.max(start, assetStart),
    to = end;
  // Bounds are supplied by the programme slot, all offsets are integer frames.
  if (to <= from) return;
  const file = await open(path, "r");
  try {
    const length = (to - from) * FRAME_BYTES;
    let read = 0;
    while (read < length) {
      const result = await file.read(
        target,
        (from - start) * FRAME_BYTES + read,
        length - read,
        (from - assetStart) * FRAME_BYTES + read,
      );
      if (!result.bytesRead) break;
      read += result.bytesRead;
    }
  } finally {
    await file.close();
  }
}
export function furniture(length, offset = 0) {
  const pcm = Buffer.alloc(length * 4);
  for (let i = 0; i < length; i++) {
    const t = (i + offset) / RATE;
    const envelope = Math.min(1, t / 0.1, Math.max(0, (18 - t) / 0.7));
    const pad =
      [110, 130.8128, 164.813].reduce(
        (sum, f) => sum + Math.sin(2 * Math.PI * f * t),
        0,
      ) * 0.018;
    const sting =
      t < 0.8
        ? Math.sin(
            2 *
              Math.PI *
              [440, 554.365, 659.255, 880][Math.min(3, Math.floor(t * 5))] *
              t,
          ) *
          0.05 *
          (1 - t / 0.8)
        : 0;
    const value = Math.round((pad + sting) * envelope * 32767);
    pcm.writeInt16LE(value, i * 4);
    pcm.writeInt16LE(value, i * 4 + 2);
  }
  return pcm;
}
// Offline airchecks use a seekable input so FFmpeg honours end padding too.
export async function decodeMP3(bytes) {
  const directory = await mkdtemp(join(tmpdir(), "omarchy-decode-"));
  try {
    const path = join(directory, "audio.mp3");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, bytes);
    return await processAudio([
      "-i",
      path,
      "-f",
      "s16le",
      "-ar",
      String(RATE),
      "-ac",
      "2",
      "pipe:1",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
