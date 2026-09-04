import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { orderTracks } from "./planner.mjs";
import { readJSON } from "./storage.mjs";
import { loadCatalog } from "./catalog.mjs";
import { Station } from "./station.mjs";
import { loadFurniture } from "./furniture.mjs";
import { Demo } from "./demo.mjs";
import { LegacyStream } from "./legacy.mjs";
import { Listeners } from "./listeners.mjs";
import { stationServer } from "./http.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = resolve(process.env.RADIO_DATA ?? join(root, "var"));
await mkdir(data, { recursive: true });
// Kernel-held lease: it is released on exit, including SIGKILL. One writer per volume.
if (!process.argv.includes("--writer")) {
  const child = spawn(
    "flock",
    [
      "--no-fork",
      "-n",
      "-E",
      "73",
      join(data, "writer.lock"),
      process.execPath,
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      "--writer",
    ],
    { stdio: "inherit" },
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    if (code === 73) console.error("Another station owns this data directory.");
    process.exitCode = code ?? 1;
  });
} else {
  let tracks = orderTracks(
    await loadCatalog(root, data),
    await readJSON(join(root, "station/programme.json"), null),
  );
  const furniture = await loadFurniture(root, data);
  if (furniture) tracks = tracks.map((track) => ({ ...track, furniture }));
  let demo;
  if (process.env.DEMO_SCENARIO) {
    const scenario = await readJSON(resolve(process.env.DEMO_SCENARIO));
    tracks = scenario.files.map((file) => {
      const track = tracks.find((t) => t.file === file);
      if (!track) throw new Error("Demo track missing: " + file);
      return track;
    });
    demo = new Demo(scenario, join(data, "recording"));
    await demo.initialize();
  }
  const station = new Station(
    tracks,
    data,
    root,
    demo
      ? {
          model: (...args) => demo.call(...args),
          tools: {},
          recorder: (...args) => demo.record(...args),
          event: (...args) => demo.event(...args),
        }
      : {},
  );
  if (demo) demo.station = station;
  await station.initialize();
  if (demo) {
    demo.attach(station);
    await demo.arrivals();
    await demo.event("show_started", {
      scenario: demo.scenario.title,
      broadcast: station.state.broadcast,
      epoch: station.state.epoch,
    });
  }
  const listeners = new Listeners(join(data, "listeners.json"));
  await listeners.restore();
  const legacy = new LegacyStream(station, listeners);
  legacy.start();
  const origins = (process.env.ALLOWED_ORIGINS ?? "https://radio.omarchy.org")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const server = stationServer(station, root, { legacy, listeners, origins });
  const stats = setInterval(() => void listeners.save().catch(() => {}), 30000);
  server.listen(
    Number(process.env.PORT ?? 8787),
    process.env.BIND ?? "127.0.0.1",
    () =>
      console.log(
        `Omarchy Radio: http://${process.env.BIND ?? "127.0.0.1"}:${process.env.PORT ?? 8787}`,
      ),
  );
  // Neither producer nor listeners drive this loop.
  const render = setInterval(() => void station.render(), 1000);
  const prepare = setInterval(
    () =>
      void (async () => {
        if (demo) await demo.arrivals();
        await station.prepare();
      })().catch(() => {}),
    5000,
  );
  const gather = async () => {
    await station.editorial.gather();
    await station.exclusive(() => station.persist());
  };
  const sources = setInterval(() => {
    if (!demo && process.env.SOURCES_ENABLED !== "false")
      void gather().catch(() => {});
  }, 300000);
  if (!demo && process.env.SOURCES_ENABLED !== "false")
    void gather().catch(() => {});
  void station.prepare();
  const shutdown = () => {
    legacy.stop();
    clearInterval(stats);
    clearInterval(render);
    clearInterval(prepare);
    clearInterval(sources);
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
