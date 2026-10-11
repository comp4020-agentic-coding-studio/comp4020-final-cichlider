import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { marked } from "marked";
import { ARENA, CELL, COLS, FADE_MS, ROLLER, ROWS, TOTAL, Turf, type Team } from "./grid.ts";
import { MIN_PER_TEAM, RADIUS, World } from "./world.ts";
import { cleanName, parseInput } from "./input.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

const TICK_MS = 50; // the simulation runs at 20 Hz
const SEND_EVERY = 2; // and everyone hears about it at 10 Hz
const IDLE_MS = 15_000; // a player who stops sending input leaves the floor

// ---------------------------------------------------------------- storage

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, "wall.db"));
// Earlier versions' tables (the crit-8 wall's `strokes`, crit 9's `paint` and
// `rounds`) stay on the volume untouched. The floor now lives in one row.
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    secret TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS floor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cells BLOB NOT NULL,
    painted BLOB NOT NULL,
    clock REAL NOT NULL,
    saved_at INTEGER NOT NULL
  );
`);
if (!(db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "team")) {
  db.exec("ALTER TABLE users ADD COLUMN team INTEGER");
}

interface User {
  id: string;
  name: string;
  team: Team | null;
}

const q = {
  userBySecret: db.prepare("SELECT id, name, team FROM users WHERE secret = ?"),
  insertUser: db.prepare("INSERT INTO users (id, secret, name, team, created_at) VALUES (?, ?, ?, ?, ?)"),
  setTeam: db.prepare("UPDATE users SET team = ? WHERE id = ?"),
  rename: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
  loadFloor: db.prepare("SELECT cells, painted, clock FROM floor WHERE id = 1"),
  saveFloor: db.prepare(`INSERT INTO floor (id, cells, painted, clock, saved_at) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET cells = excluded.cells, painted = excluded.painted, clock = excluded.clock, saved_at = excluded.saved_at`),
};

const ADJ = ["wild", "neon", "quiet", "lucky", "rusty", "fizzy", "sly", "brave", "tiny", "loud", "mossy", "sunny"];
const NOUN = ["fox", "can", "drip", "moth", "crow", "wave", "kite", "brick", "comet", "frog", "pixel", "tide"];
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

// ---------------------------------------------------------------- the world

// The game clock only runs while at least one person is on the floor. When
// everyone leaves, the world freezes: NPCs stop, and paint stops fading, so the
// floor is exactly as they left it when someone comes back — even after the
// machine has been stopped and started again.
const turf = new Turf();
const world = new World(turf);
let clock = 0;
let floorDirty = false;

{
  const saved = q.loadFloor.get() as { cells: Uint8Array; painted: Uint8Array; clock: number } | undefined;
  if (saved) {
    const painted = new Float64Array(saved.painted.buffer.slice(saved.painted.byteOffset, saved.painted.byteOffset + saved.painted.byteLength));
    turf.restore(saved.cells, painted);
    clock = saved.clock;
  }
  turf.drain();
}

function saveFloor(): void {
  q.saveFloor.run(turf.cells, new Uint8Array(turf.painted.buffer), clock, Date.now());
  floorDirty = false;
}

const rollersWire = () =>
  [...world.rollers.values()].map((r) => [r.id, r.team, Math.round(r.x), Math.round(r.y), Math.round(r.h * 100) / 100, r.move, r.npc ? 1 : 0, r.name]);

// the head of each running drip, so clients can draw the bead of paint
const dripsWire = () => world.drips.map((d) => [Math.round(d.x), Math.round(d.y), d.team]);

let ticks = 0, lastReal = Date.now(), sinceHousekeeping = 0;
setInterval(() => {
  const real = Date.now();
  const dt = Math.min(250, real - lastReal); // a stalled event loop shouldn't teleport anyone
  lastReal = real;
  const running = world.humans() > 0;
  if (running) {
    clock += dt;
    world.step(dt / 1000, clock);
    turf.fade(clock); // every tick, so no cell is ever shown past its fade time
    sinceHousekeeping += dt;
    if (sinceHousekeeping >= 1000) {
      sinceHousekeeping = 0;
      world.expire(clock, IDLE_MS);
      world.reconcileNpcs(clock);
    }
  }
  if (++ticks % SEND_EVERY !== 0) return;
  const cells = turf.drain();
  if (cells.length) floorDirty = true;
  // while the world is frozen, a heartbeat a second is plenty
  if (!clients.size || (!running && !cells.length && ticks % 20 !== 0)) return;
  broadcast({ type: "tick", t: clock, r: rollersWire(), d: dripsWire(), c: cells, s: [...turf.counts] });
}, TICK_MS).unref();

setInterval(() => { if (floorDirty) saveFloor(); }, 5000).unref();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    if (floorDirty) saveFloor();
    process.exit(0);
  });
}

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

// A short burst and a steady rate: plenty for someone mashing keys, not
// enough for a script to flood the server.
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

// ---------------------------------------------------------------- teams

// A newcomer joins the side with fewer people on the floor right now. NPCs
// don't count: they make way as soon as someone joins.
function balancedTeam(): Team {
  const a = world.humans(0), b = world.humans(1);
  return a === b ? (Math.random() < 0.5 ? 0 : 1) : a < b ? 0 : 1;
}

function withTeam(user: User): User & { team: Team } {
  if (user.team === 0 || user.team === 1) return user as User & { team: Team };
  const team = balancedTeam();
  q.setTeam.run(team, user.id);
  return { ...user, team };
}

// ---------------------------------------------------------------- http helpers

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 16 * 1024): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function authed(req: IncomingMessage): (User & { team: Team }) | null {
  const m = (req.headers.authorization ?? "").match(/^Bearer (\S+)$/);
  const user = m ? (q.userBySecret.get(m[1]) as User | undefined) : undefined;
  return user ? withTeam(user) : null;
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
<title>About Turf War</title><link rel="stylesheet" href="/readme.css" /></head>
<body><main><p class="back"><a href="/">← back to the floor</a></p>${body}</main></body></html>`;
}

// ---------------------------------------------------------------- routes

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://turf");
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
      const found = q.userBySecret.get(body.secret) as User | undefined;
      if (found) return send(res, 200, { ...withTeam(found), secret: body.secret });
    }
    const user = { id: randomUUID(), name: `${pick(ADJ)}-${pick(NOUN)}`, team: balancedTeam() };
    const secret = randomBytes(24).toString("base64url");
    q.insertUser.run(user.id, secret, user.name, user.team, Date.now());
    return send(res, 201, { ...user, secret });
  }

  if (path === "/api/me" && method === "PATCH") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown player" });
    const name = cleanName(((await readJson(req)) as { name?: unknown }).name);
    if (!name) return send(res, 400, { error: "name must be 1-24 characters" });
    q.rename.run(name, user.id);
    const r = world.rollers.get(user.id);
    if (r) r.name = name;
    return send(res, 200, { id: user.id, name, team: user.team });
  }

  // Which of the five actions you're doing now. The first one puts your roller
  // on the floor; after that, sending it again (even "still") keeps you there.
  if (path === "/api/input" && method === "POST") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown player" });
    if (!allow("in:" + user.id, 1, 30, 60)) return send(res, 429, { error: "slow down a little" });
    const input = parseInput(await readJson(req));
    if (typeof input === "string") return send(res, 400, { error: input });
    if (!world.rollers.has(user.id)) {
      world.spawn(user.id, user.team, user.name, false, clock);
      world.reconcileNpcs(clock);
    }
    world.setInput(user.id, input.move, input.turn, clock);
    return send(res, 202, { ok: true });
  }

  // Everything a client needs to draw the wall from scratch. The paint goes as
  // two base64 arrays, one entry per cell: owner (0 bare, 1, 2), and how long
  // ago it was painted, in tenths of a second.
  if (path === "/api/state" && method === "GET") {
    const ages = new Uint16Array(TOTAL);
    for (let i = 0; i < TOTAL; i++) if (turf.cells[i]) ages[i] = Math.min(65535, Math.round((clock - turf.painted[i]) / 100));
    return send(res, 200, {
      t: clock,
      arena: ARENA, cell: CELL, cols: COLS, rows: ROWS, roller: ROLLER, radius: RADIUS,
      fadeMs: FADE_MS, minPerTeam: MIN_PER_TEAM,
      rollers: rollersWire(),
      drips: dripsWire(),
      owners: Buffer.from(turf.cells).toString("base64"),
      ages: Buffer.from(ages.buffer).toString("base64"),
      s: [...turf.counts],
      total: TOTAL,
      humans: [world.humans(0), world.humans(1)],
    });
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
    req.on("close", () => clients.delete(res));
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
  console.log(`turf war on 0.0.0.0:${PORT}, data in ${DATA_DIR}`);
});
