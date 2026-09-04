// Assemble an honest edit from real browser frames and the same broadcast clock.
// frames.jsonl rows: {name, wall (milliseconds), position (programme seconds)}.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const directory = resolve(process.argv[2] ?? "var-demo");
const output = resolve(process.argv[3] ?? "demo/live-demo.mp4");
const jsonl = async (path) =>
  (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
const footage = (await jsonl(join(directory, "video/frames.jsonl"))).filter(
  (f) => Number.isFinite(f.position) && f.running,
);
const events = await jsonl(join(directory, "recording/events.jsonl"));
const links = events.filter((e) => e.type === "link_committed");
const groups = [];
for (const frame of footage) {
  const group = groups.at(-1);
  if (!group || frame.wall - group.at(-1).wall > 2000) groups.push([frame]);
  else group.push(frame);
}
const working = join(directory, "edit");
await mkdir(working, { recursive: true });
const run = (args) =>
  new Promise((ok, fail) => {
    const child = spawn("ffmpeg", ["-y", "-v", "error", ...args], {
      stdio: "inherit",
    });
    child.on("error", fail);
    child.on("exit", (code) =>
      code === 0 ? ok() : fail(new Error("FFmpeg " + code)),
    );
  });
const wrap = (text) =>
  text
    .split(/\s+/)
    .reduce(
      (lines, word) => {
        if ((lines.at(-1) + " " + word).length > 36) lines.push(word);
        else lines[lines.length - 1] += (lines.at(-1) ? " " : "") + word;
        return lines;
      },
      [""],
    )
    .join("\n");
const stamp = (t) =>
  `${Math.floor(t / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
const clips = [];
const cuts = [];
for (const [i, group] of groups.entries()) {
  if (group.length < 5) continue;
  const start = group[0].position,
    duration = (group.at(-1).wall - group[0].wall) / 1000 + 0.5;
  const link = links.find(
    (e) =>
      e.link.start / 44100 >= start && e.link.start / 44100 < start + duration,
  );
  if (i > 0 && !link) continue;
  const title = link
    ? `PRESENTATION ${links.indexOf(link) + 1}`
    : "OMARCHY RADIO";
  const source = link?.link.source;
  const measured =
    link &&
    events.find(
      (e) => e.type === "speech_measured" && e.text === link.link.text,
    );
  const arrival =
    source &&
    events.find(
      (e) => e.type === "source_arrived" && e.source.url === source.url,
    );
  const body = link
    ? `${source ? wrap(source.title) + "\n\nSource: " + source.author : "Station continuity"}\n${arrival ? "Arrived at " + stamp(arrival.frame / 44100) + "\n" : ""}Ready at ${stamp(link.frame / 44100)}\nOn air at ${stamp(link.link.start / 44100)}\n${((link.link.end - link.link.start) / 44100).toFixed(1)}s speech / ${measured ? ((measured.window.end - measured.window.start) / 44100).toFixed(0) : "17"}s safe window\n\n${wrap(link.link.text)}`
    : "The original player.\nOne shared live programme.\n\nSeparate music and DJ streams.\nLive-generated presentation.\n\nIdents, jingle and 30s bed:\nprerecorded station furniture.\n\nRecorded in real time.\nMusic gaps cut from this edit.\n\nThe sources arrive on a schedule.\nThe presenter is not scripted.";
  const text = join(working, `text-${i}.txt`),
    heading = join(working, `heading-${i}.txt`),
    list = join(working, `frames-${i}.txt`),
    clip = join(working, `clip-${i}.mp4`);
  await writeFile(text, body);
  await writeFile(heading, `${title}\nFROM ${stamp(start)}`);
  await writeFile(
    list,
    group
      .map(
        (f, j) =>
          `file '${join(directory, "video", f.name)}'\nduration ${j + 1 < group.length ? (group[j + 1].wall - f.wall) / 1000 : 0.5}\n`,
      )
      .join("") + `file '${join(directory, "video", group.at(-1).name)}'\n`,
  );
  await run([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-f",
    "s16le",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-ss",
    String(start),
    "-i",
    join(directory, "recording/mix.s16le"),
    "-t",
    String(duration),
    "-vf",
    `scale=930:890:force_original_aspect_ratio=decrease,pad=1600:900:20:5:color=0x090d0b,drawtext=textfile=${heading}:fontcolor=0x50f0a0:fontsize=34:x=985:y=48:line_spacing=12,drawtext=textfile=${text}:fontcolor=0xd7e4dc:fontsize=24:x=985:y=168:line_spacing=10,drawtext=text='TIMED SOURCE REPLAY / LIVE MODELS + TTS':fontcolor=0x75a68c:fontsize=19:x=985:y=855`,
    "-af",
    "volume=0.8",
    "-r",
    "15",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "25",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    clip,
  ]);
  clips.push(clip);
  cuts.push({ showStart: start, duration, link: link?.link.id ?? null });
}
const list = join(working, "clips.txt");
await writeFile(list, clips.map((f) => `file '${f}'\n`).join(""));
await run([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  list,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  output,
]);
await writeFile(join(working, "cuts.json"), JSON.stringify(cuts, null, 2));
console.log(`Saved ${clips.length} live excerpts to ${output}`);
