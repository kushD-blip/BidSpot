// dev-server.mjs — local alternative to `vercel dev`.
//
// Vercel's CLI needs the project linked to a Vercel account (interactive login +
// `vercel link` on first run) just to run functions locally. This skips all of that:
// it's a plain Node http server that serves the static site AND executes the real
// files in /api unmodified, by shimming just the bits of the Vercel request/response
// API those files actually use (req.method, req.headers, req.body, res.status().json()).
//
// Run with:  node --env-file=.env dev-server.mjs
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".sql": "text/plain; charset=utf-8",
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function shimResponse(res) {
  res.status = function (code) {
    res.statusCode = code;
    return res;
  };
  res.json = function (body) {
    const payload = JSON.stringify(body);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(payload);
    return res;
  };
  res.send = function (body) {
    res.end(typeof body === "string" ? body : JSON.stringify(body));
    return res;
  };
  return res;
}

async function handleApi(req, res, pathname) {
  shimResponse(res);

  // /api/foo -> api/foo.js ; /api/cron/bar -> api/cron/bar.js
  const rel = pathname.replace(/^\/api\//, "").replace(/\/+$/, "");
  const filePath = path.join(ROOT, "api", `${rel}.js`);
  const apiRoot = path.join(ROOT, "api");

  // Bare startsWith(apiRoot) would also accept a sibling directory that merely
  // shares the prefix string (e.g. "api-evil"); requiring the separator (or an
  // exact match) after it closes that off.
  if (filePath !== apiRoot && !filePath.startsWith(apiRoot + path.sep)) {
    res.status(400).json({ error: "Bad path." });
    return;
  }

  let mod;
  try {
    // cache-bust so edits to api/*.js or lib/*.js are picked up without restarting
    mod = await import(`${pathToFileURL(filePath)}?t=${Date.now()}`);
  } catch (err) {
    console.error(`No function for ${pathname}:`, err.message);
    res.status(404).json({ error: "Not found." });
    return;
  }

  const raw = await readBody(req);
  req.body = {};
  if (raw.length) {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("application/json")) {
      try {
        req.body = JSON.parse(raw.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON body." });
        return;
      }
    }
  }

  try {
    await mod.default(req, res);
  } catch (err) {
    console.error(`Error in ${pathname}:`, err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error." });
  }
}

function pathToFileURL(p) {
  return "file://" + p.replace(/\\/g, "/");
}

async function handleStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";

  let filePath = path.join(ROOT, rel);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(400).end("Bad path");
    return;
  }

  // vercel.json has "cleanUrls": true -> /about resolves to about.html
  const candidates = [filePath];
  if (!path.extname(filePath)) {
    candidates.push(`${filePath}.html`, path.join(filePath, "index.html"));
  }

  for (const candidate of candidates) {
    try {
      const data = await fs.readFile(candidate);
      const ext = path.extname(candidate);
      // This bit us twice already in this session (stale index.html, then stale
      // categories.js) — the browser's own heuristic cache re-serving an old copy
      // of a JS/HTML file with no revalidation, edit-on-disk notwithstanding.
      // Local dev should never do that: force a fresh fetch every time.
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
      return;
    } catch {
      // try next candidate
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("404 Not Found");
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
    } else {
      await handleStatic(req, res, pathname);
    }
  } catch (err) {
    console.error("Unhandled error:", err);
    if (!res.headersSent) res.writeHead(500).end("Internal server error");
  }
});

server.listen(PORT, () => {
  console.log(`BidSpot dev server (with working /api) running at http://localhost:${PORT}`);
});
