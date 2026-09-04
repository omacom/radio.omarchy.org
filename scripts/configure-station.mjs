import { writeFile } from "node:fs/promises";
const value = process.argv[2];
if (!value) throw new Error("Supply the backend origin, or off");
let origin = false;
if (value !== "off") {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  )
    throw new Error("Use HTTPS, or localhost for a demo");
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Supply an origin without a path or credentials");
  origin = url.origin;
}
await writeFile(
  "station-config.js",
  `// Public backend origin only. Never put credentials in this file.\nwindow.OMARCHY_STATION = ${JSON.stringify(origin)};\n`,
);
console.log(
  origin
    ? `Frontend configured for ${origin}`
    : "Frontend uses the original upstream live stream",
);
