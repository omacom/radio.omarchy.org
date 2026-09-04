import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, realpath } from "node:fs/promises";
import { join, resolve, extname, sep } from "node:path";
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".xml": "application/xml",
};
export async function file(req, res, path, root, immutable = false) {
  const actual = await realpath(path);
  if (!actual.startsWith(resolve(root) + sep))
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  const info = await stat(actual);
  if (!info.isFile())
    throw Object.assign(new Error("Missing"), { status: 404 });
  let start = 0,
    end = info.size - 1,
    status = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!match || (!match[1] && !match[2])) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      return res.end();
    }
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= info.size
    ) {
      res.writeHead(416, { "content-range": `bytes */${info.size}` });
      return res.end();
    }
    status = 206;
  }
  res.writeHead(status, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "content-length": end - start + 1,
    "accept-ranges": "bytes",
    "cache-control": immutable ? "public, max-age=120, immutable" : "no-cache",
    ...(status === 206
      ? { "content-range": `bytes ${start}-${end}/${info.size}` }
      : {}),
  });
  if (req.method === "HEAD") return res.end();
  const stream = createReadStream(actual, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
export function stationServer(
  station,
  root,
  { origins = [], legacy, listeners } = {},
) {
  return createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    const origin = req.headers.origin;
    if (origin && origins.includes(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader(
        "access-control-expose-headers",
        "Content-Length, Content-Range, Accept-Ranges, Icy-Name, Icy-Genre, Icy-Br, Icy-Sr, Icy-Metaint",
      );
    }
    if (req.method === "OPTIONS") {
      if (!origin || !origins.includes(origin)) {
        res.writeHead(403);
        return res.end();
      }
      res.writeHead(204, {
        "access-control-allow-methods": "GET, HEAD, OPTIONS",
        "access-control-allow-headers": "Icy-MetaData, Range",
        "access-control-max-age": "600",
      });
      return res.end();
    }
    try {
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405);
        return res.end();
      }
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const json = (data, status = 200) => {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(req.method === "HEAD" ? "" : JSON.stringify(data));
      };
      if (path === "/station-config.js") {
        res.writeHead(200, {
          "content-type": "text/javascript",
          "cache-control": "no-store",
        });
        return res.end("window.OMARCHY_STATION = true;");
      }
      if (path === "/api/station") {
        listeners?.touch(
          new URL(req.url, "http://localhost").searchParams.get("listener"),
        );
        return json(station.manifest());
      }
      if (path === "/api/statistics")
        return json({ stations: { omarchy: listeners?.snapshot() ?? null } });
      if (path === "/omarchy/stream" && legacy) {
        if (req.method === "HEAD") {
          res.writeHead(200, { "content-type": "audio/mpeg" });
          return res.end();
        }
        return legacy.add(req, res);
      }
      if (path === "/api/health") {
        const ready =
          (station.manifest().lastSequence ?? -1) * 4 * 44100 >= station.now();
        return json({ ready }, ready ? 200 : 503);
      }
      if (path === "/api/ops") {
        if (
          !process.env.OPS_TOKEN ||
          req.headers.authorization !== `Bearer ${process.env.OPS_TOKEN}`
        )
          return json({ error: "Unauthorized" }, 401);
        return json({
          metrics: station.metrics,
          editorial: station.state.editorial,
        });
      }
      const match =
        /^\/api\/audio\/([a-f0-9-]{36})\/(\d+)\/(music|dj)\.mp3$/.exec(path);
      if (match) {
        const [, broadcast, number, stem] = match,
          seq = Number(number);
        if (broadcast !== station.state.broadcast)
          return json({ error: "Broadcast changed" }, 410);
        if (!Number.isSafeInteger(seq) || !station.sealed.has(seq))
          return json({ error: "Segment outside available window" }, 404);
        return await file(
          req,
          res,
          join(station.data, "segments", `${broadcast}-${seq}`, `${stem}.mp3`),
          station.data,
          true,
        );
      }
      if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
      if (path === "/" || path === "/index.html")
        return await file(req, res, join(root, "index.html"), root);
      const allowed =
        /^\/(assets\/[\w ./()-]+|tracks\/[^/]+\.mp3|tracks\/playlist\.json|tracks\/lyrics\/[^/]+\.(json|txt)|sw\.js|favicon\.ico|site\.webmanifest|robots\.txt|sitemap\.xml)$/u;
      if (
        !allowed.test(path) ||
        path.split("/").some((part) => part.startsWith("."))
      )
        return json({ error: "Not found" }, 404);
      return await file(req, res, join(root, path), root);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(error.status ?? (error.code === "ENOENT" ? 404 : 500), {
          "cache-control": "no-store",
        });
        res.end("Unavailable");
      } else res.destroy();
    }
  });
}
