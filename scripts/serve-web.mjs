// Local GitHub Pages equivalent. It has no editorial runtime or credentials API.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { file } from "../server/http.mjs";
const root = resolve(".");
createServer(async (req, res) => {
  try {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      return res.end();
    }
    const path = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    if (path === "/station-config.js") {
      res.writeHead(200, {
        "content-type": "text/javascript",
        "cache-control": "no-store",
      });
      return res.end(
        `window.OMARCHY_STATION=${JSON.stringify(process.env.STATION_ORIGIN ?? "http://127.0.0.1:8788")};`,
      );
    }
    if (path === "/sw.js") {
      res.writeHead(404);
      return res.end();
    }
    if (
      !(
        path === "/" ||
        path === "/index.html" ||
        /^\/(assets|tracks)\//.test(path) ||
        ["/favicon.ico", "/site.webmanifest"].includes(path)
      ) ||
      path.split("/").some((p) => p.startsWith("."))
    ) {
      res.writeHead(404);
      return res.end();
    }
    await file(
      req,
      res,
      resolve("." + (path === "/" ? "/index.html" : path)),
      root,
    );
  } catch {
    if (!res.headersSent) {
      res.writeHead(404);
      res.end();
    } else res.destroy();
  }
}).listen(Number(process.env.WEB_PORT ?? 8790), "127.0.0.1", () =>
  console.log(
    "Static frontend: http://127.0.0.1:" + (process.env.WEB_PORT ?? 8790),
  ),
);
