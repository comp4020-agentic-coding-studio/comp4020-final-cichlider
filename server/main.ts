import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { marked } from "marked";
import { boundsOf, cleanName, parseStroke } from "./stroke.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

// ---------------------------------------------------------------- storage

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, "wall.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    secret TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS strokes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL REFERENCES users(id),
    tool TEXT NOT NULL,
    color TEXT NOT NULL,
    size REAL NOT NULL,
    opacity REAL NOT NULL,
    fill INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    points TEXT NOT NULL,
    minx REAL NOT NULL, miny REAL NOT NULL, maxx REAL NOT NULL, maxy REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS strokes_x ON strokes(minx, maxx);
  CREATE INDEX IF NOT EXISTS strokes_created ON strokes(created_at);
`);

interface User {
  id: string;
  name: string;
}

interface StrokeRow {
  id: number;
  author: string;
  tool: string;
  color: string;
  size: number;
  opacity: number;
  fill: number;
  seed: number;
  points: string;
  created_at: number;
}

const q = {
  userBySecret: db.prepare("SELECT id, name FROM users WHERE secret = ?"),
  insertUser: db.prepare("INSERT INTO users (id, secret, name, created_at) VALUES (?, ?, ?, ?)"),
  rename: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
  insertStroke: db.prepare(`INSERT INTO strokes
    (author, tool, color, size, opacity, fill, seed, points, minx, miny, maxx, maxy, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  strokesIn: db.prepare(`SELECT id, author, tool, color, size, opacity, fill, seed, points, created_at
    FROM strokes WHERE maxx >= ? AND minx <= ? AND maxy >= ? AND miny <= ?
    ORDER BY id LIMIT 20000`),
  strokeAuthor: db.prepare("SELECT author FROM strokes WHERE id = ?"),
  deleteStroke: db.prepare("DELETE FROM strokes WHERE id = ?"),
  namesIn: db.prepare(`SELECT DISTINCT u.id, u.name FROM strokes s JOIN users u ON u.id = s.author
    WHERE s.maxx >= ? AND s.minx <= ? AND s.maxy >= ? AND s.miny <= ?`),
  // Where people have been painting lately, by 1200-unit patch of wall.
  hotspots: db.prepare(`SELECT ROUND(AVG((minx + maxx) / 2)) AS x, ROUND(AVG((miny + maxy) / 2)) AS y,
      COUNT(*) AS n, MAX(created_at) AS last
    FROM strokes GROUP BY CAST(FLOOR((minx + maxx) / 2400) AS INT), CAST(FLOOR((miny + maxy) / 2400) AS INT)
    ORDER BY last DESC LIMIT 40`),
};

const toWire = (r: StrokeRow) => ({
  id: r.id,
  author: r.author,
  tool: r.tool,
  color: r.color,
  size: r.size,
  opacity: r.opacity,
  fill: r.fill === 1,
  seed: r.seed,
  points: JSON.parse(r.points) as number[],
  createdAt: r.created_at,
});

const ADJ = ["wild", "neon", "quiet", "lucky", "rusty", "fizzy", "sly", "brave", "tiny", "loud", "mossy", "sunny"];
const NOUN = ["fox", "can", "drip", "moth", "crow", "wave", "kite", "brick", "comet", "frog", "pixel", "tide"];
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// ---------------------------------------------------------------- live events

const clients = new Set<ServerResponse>();

function broadcast(event: object): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(data);
}

// Fly's proxy drops idle connections, so the stream carries a comment now and then.
setInterval(() => {
  for (const res of clients) res.write(": ping\n\n");
}, 20_000).unref();

// A painter gets a short burst and a steady rate; enough to scribble fast,
// not enough for a script to bury the wall.
const buckets = new Map<string, { tokens: number; at: number }>();
function allow(id: string, cost = 1, rate = 4, burst = 40): boolean {
  const now = Date.now();
  const b = buckets.get(id) ?? { tokens: burst, at: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  buckets.set(id, b);
  if (b.tokens < cost) return false;
  b.tokens -= cost;
  return true;
}

// ---------------------------------------------------------------- http helpers

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 512 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function authed(req: IncomingMessage): User | null {
  const m = (req.headers.authorization ?? "").match(/^Bearer (\S+)$/);
  return m ? ((q.userBySecret.get(m[1]) as User | undefined) ?? null) : null;
}

function box(url: URL): [number, number, number, number] | null {
  const v = ["x0", "x1", "y0", "y1"].map((k) => Number(url.searchParams.get(k)));
  if (!v.every(Number.isFinite)) return null;
  const [x0, x1, y0, y1] = v;
  return [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// README images are linked relatively (docs/x.png), so from /readme/ they're
// asked for as /readme/docs/x.png.
function serveStatic(res: ServerResponse, path: string): boolean {
  const docs = path.startsWith("/readme/docs/");
  const dir = docs ? join(ROOT, "docs") : PUBLIC;
  const file = resolve(dir, "." + (docs ? path.slice("/readme/docs".length) : path === "/" ? "/index.html" : path));
  if (!file.startsWith(dir + "/") || !TYPES[extname(file)]) return false;
  try {
    const body = readFileSync(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)], "cache-control": "no-cache" });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// README.md, rendered on the server so /readme/ is complete without scripts.
function readmePage(): string {
  const body = marked.parse(readFileSync(join(ROOT, "README.md"), "utf8"), { async: false });
  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>About the wall</title><link rel="stylesheet" href="/readme.css" /></head>
<body><main><p class="back"><a href="/">← back to the wall</a></p>${body}</main></body></html>`;
}

// ---------------------------------------------------------------- routes

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://wall");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && (path === "/readme" || path === "/readme/")) {
    if (path === "/readme") {
      res.writeHead(301, { location: "/readme/" });
      return void res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    return void res.end(readmePage());
  }

  if (path === "/api/session" && method === "POST") {
    const body = (await readJson(req)) as { secret?: unknown };
    if (typeof body.secret === "string") {
      const user = q.userBySecret.get(body.secret) as User | undefined;
      if (user) return send(res, 200, { ...user, secret: body.secret });
    }
    const user = { id: randomUUID(), name: `${pick(ADJ)}-${pick(NOUN)}` };
    const secret = randomBytes(24).toString("base64url");
    q.insertUser.run(user.id, secret, user.name, Date.now());
    return send(res, 201, { ...user, secret });
  }

  if (path === "/api/me" && method === "PATCH") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown painter" });
    const name = cleanName(((await readJson(req)) as { name?: unknown }).name);
    if (!name) return send(res, 400, { error: "name must be 1-24 characters" });
    q.rename.run(name, user.id);
    broadcast({ type: "name", id: user.id, name });
    return send(res, 200, { id: user.id, name });
  }

  if (path === "/api/strokes" && method === "GET") {
    const b = box(url);
    if (!b) return send(res, 400, { error: "x0, x1, y0, y1 are required numbers" });
    const [x0, x1, y0, y1] = b;
    const strokes = (q.strokesIn.all(x0, x1, y0, y1) as unknown as StrokeRow[]).map(toWire);
    const names = Object.fromEntries((q.namesIn.all(x0, x1, y0, y1) as unknown as User[]).map((u) => [u.id, u.name]));
    return send(res, 200, { strokes, names });
  }

  if (path === "/api/strokes" && method === "POST") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown painter" });
    const parsed = parseStroke(await readJson(req));
    if (typeof parsed === "string") return send(res, 400, { error: parsed });
    if (!allow(user.id, 1 + parsed.points.length / 2000)) return send(res, 429, { error: "slow down a little" });
    const bb = boundsOf(parsed);
    const now = Date.now();
    const { lastInsertRowid } = q.insertStroke.run(
      user.id, parsed.tool, parsed.color, parsed.size, parsed.opacity, parsed.fill ? 1 : 0,
      parsed.seed, JSON.stringify(parsed.points), bb.minx, bb.miny, bb.maxx, bb.maxy, now,
    );
    const stroke = { id: Number(lastInsertRowid), author: user.id, ...parsed, createdAt: now };
    broadcast({ type: "stroke", stroke, name: user.name });
    return send(res, 201, stroke);
  }

  const del = path.match(/^\/api\/strokes\/(\d+)$/);
  if (del && method === "DELETE") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown painter" });
    const id = Number(del[1]);
    const row = q.strokeAuthor.get(id) as { author: string } | undefined;
    if (!row) return send(res, 404, { error: "no such stroke" });
    if (row.author !== user.id) return send(res, 403, { error: "you can only take back your own marks" });
    q.deleteStroke.run(id);
    broadcast({ type: "delete", id });
    return send(res, 200, { id });
  }

  // Ephemeral: where someone's cursor is and the stroke they're halfway through.
  // Nothing here is stored.
  if (path === "/api/live" && method === "POST") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown painter" });
    if (!allow("live:" + user.id, 1, 25, 50)) return send(res, 429, { error: "slow down a little" });
    const body = (await readJson(req, 128 * 1024)) as { cursor?: unknown; partial?: unknown; done?: unknown };
    const cursor = Array.isArray(body.cursor) && body.cursor.length === 2 && body.cursor.every((n) => typeof n === "number" && Number.isFinite(n))
      ? body.cursor : null;
    const partial = body.partial === undefined || body.partial === null ? null : parseStroke(body.partial);
    if (typeof partial === "string") return send(res, 400, { error: partial });
    broadcast({ type: "live", id: user.id, name: user.name, cursor, partial, done: body.done === true });
    return send(res, 202, { ok: true });
  }

  if (path === "/api/hotspots" && method === "GET") {
    return send(res, 200, { spots: q.hotspots.all() });
  }

  if (path === "/api/events" && method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": hello\n\n");
    clients.add(res);
    broadcast({ type: "presence", count: clients.size });
    req.on("close", () => {
      clients.delete(res);
      broadcast({ type: "presence", count: clients.size });
    });
    return;
  }

  if (method === "GET" && serveStatic(res, path)) return;
  send(res, 404, { error: "not found" });
}

createServer((req, res) => {
  route(req, res).catch((err: Error) => {
    if (!res.headersSent) send(res, err instanceof SyntaxError || /too large/.test(err.message) ? 400 : 500, { error: err.message });
    else res.end();
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`wall listening on 0.0.0.0:${PORT}, data in ${DATA_DIR}`);
});
