import { mkdir, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
const data = resolve(process.env.RADIO_DATA ?? "var-demo");
await mkdir(data, { recursive: true });
try {
  await access(join(data, "station.json"));
  throw new Error("Use a fresh RADIO_DATA directory for each recorded demo.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const child = spawn(
  process.execPath,
  ["--env-file-if-exists=.env", "server/index.mjs"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      RADIO_DATA: data,
      DEMO_SCENARIO: resolve(process.env.DEMO_SCENARIO ?? "demo/show.json"),
    },
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("exit", (code) => (process.exitCode = code ?? 1));
