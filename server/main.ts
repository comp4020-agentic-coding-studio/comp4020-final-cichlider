import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { marked } from "marked";
import { ARENA, CELL, ROLLER, TOTAL, Turf, winnerOf, type Team } from "./grid.ts";
import { cleanName, parseStroke, pathLength } from "./stroke.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const ROOT = resolve(import.meta.dirname, "..");
const PUBLIC = join(ROOT, "public");

// A round, then a short break to read the result, then the next round.
const ROUND_MS = Number(process.env.ROUND_MS ?? 150_000);
const BREAK_MS = Number(process.env.BREAK_MS ?? 8_000);

// Placeholder colours until the homepage palette lands. Strokes store the team,
// never the colour, so changing these repaints every round, old and current.
const TEAMS = [
  { name: "Pink", color: "#f02d7d" },
  { name: "Lime", color: "#80ff00" },
] as const;

// The ink tank: rolling costs ink by distance, and it refills on its own. The
// client runs the same numbers to draw the meter; the server is the referee.
const INK_MAX = 1500;
const INK_RATE = 150; // per second
const INK_SLACK = 1.15; // the client's clock and ours never quite agree

// ---------------------------------------------------------------- storage

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, "wall.db"));
// The free-painting wall's `strokes` table from crit 8 is left where it is on
// the volume, untouched: turf war keeps its paint in `paint`, per round.
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    secret TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    ended_at INTEGER,
    a_cells INTEGER,
    b_cells INTEGER,
    winner INTEGER
  );
  CREATE TABLE IF NOT EXISTS paint (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    author TEXT NOT NULL REFERENCES users(id),
    team INTEGER NOT NULL,
    seed INTEGER NOT NULL,
    points TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS paint_round ON paint(round_id, id);
`);
// Painters from the wall days predate teams; they get one the next time they come.
if (!(db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).some((c) => c.name === "team")) {
  db.exec("ALTER TABLE users ADD COLUMN team INTEGER");
}

interface User {
  id: string;
  name: string;
  team: Team | null;
}

interface PaintRow {
  id: number;
  author: string;
  team: Team;
  seed: number;
  points: string;
  created_at: number;
}

interface RoundRow {
  id: number;
  started_at: number;
  ends_at: number;
}

const q = {
  userBySecret: db.prepare("SELECT id, name, team FROM users WHERE secret = ?"),
  insertUser: db.prepare("INSERT INTO users (id, secret, name, team, created_at) VALUES (?, ?, ?, ?, ?)"),
  setTeam: db.prepare("UPDATE users SET team = ? WHERE id = ?"),
  rename: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
  openRound: db.prepare("SELECT id, started_at, ends_at FROM rounds WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1"),
  insertRound: db.prepare("INSERT INTO rounds (started_at, ends_at) VALUES (?, ?)"),
  endRound: db.prepare("UPDATE rounds SET ended_at = ?, a_cells = ?, b_cells = ?, winner = ? WHERE id = ?"),
  // Once a round is scored its paint is spent: the result row is what's kept.
  clearPaint: db.prepare("DELETE FROM paint WHERE round_id = ?"),
  insertPaint: db.prepare("INSERT INTO paint (round_id, author, team, seed, points, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
  paintIn: db.prepare("SELECT id, author, team, seed, points, created_at FROM paint WHERE round_id = ? ORDER BY id"),
  namesIn: db.prepare("SELECT DISTINCT u.id, u.name FROM paint p JOIN users u ON u.id = p.author WHERE p.round_id = ?"),
  lastResult: db.prepare(`SELECT id, ended_at, a_cells, b_cells, winner FROM rounds
    WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1`),
};

const toWire = (r: PaintRow) => ({
  id: r.id,
  author: r.author,
  team: r.team,
  tool: "roller",
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

// A painter gets a short burst and a steady rate; enough to roll fast,
// not enough for a script to flood the stream.
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

// Each painter's tank, filled lazily from when we last looked.
const tanks = new Map<string, { ink: number; at: number }>();
function inkOf(id: string, now = Date.now()): { ink: number; at: number } {
  const t = tanks.get(id) ?? { ink: INK_MAX, at: now };
  t.ink = Math.min(INK_MAX, t.ink + ((now - t.at) / 1000) * INK_RATE);
  t.at = now;
  tanks.set(id, t);
  return t;
}

// ---------------------------------------------------------------- teams

// Who's been doing anything lately, and for which team. A newcomer joins the
// side with fewer of these, so the two sides stay even with whoever is here now
// rather than with everyone who ever visited.
const ACTIVE_MS = 60_000;
const seen = new Map<string, { team: Team; at: number }>();
const touch = (u: { id: string; team: Team }) => seen.set(u.id, { team: u.team, at: Date.now() });

function players(): [number, number] {
  const now = Date.now();
  const n: [number, number] = [0, 0];
  for (const [id, s] of seen) {
    if (now - s.at > ACTIVE_MS) seen.delete(id);
    else n[s.team]++;
  }
  return n;
}

function balancedTeam(): Team {
  const [a, b] = players();
  return a === b ? (Math.random() < 0.5 ? 0 : 1) : a < b ? 0 : 1;
}

// ---------------------------------------------------------------- rounds

const turf = new Turf();
let round: RoundRow | null = null;
let nextAt = 0; // when the next round starts, while there isn't one

function startRound(now = Date.now()): void {
  const ends = now + ROUND_MS;
  const { lastInsertRowid } = q.insertRound.run(now, ends);
  round = { id: Number(lastInsertRowid), started_at: now, ends_at: ends };
  turf.clear();
  broadcast({ type: "round-start", round: roundWire() });
}

function endRound(now = Date.now()): void {
  if (!round) return;
  const winner = winnerOf(turf.counts);
  q.endRound.run(now, turf.counts[0], turf.counts[1], winner, round.id);
  q.clearPaint.run(round.id);
  const result = { roundId: round.id, cells: [...turf.counts], total: TOTAL, winner };
  round = null;
  nextAt = now + BREAK_MS;
  turf.clear();
  broadcast({ type: "round-end", result, nextAt });
}

const roundWire = () => (round ? { id: round.id, startedAt: round.started_at, endsAt: round.ends_at } : null);

function lastResult() {
  const r = q.lastResult.get() as { id: number; a_cells: number; b_cells: number; winner: Team | null } | undefined;
  return r ? { roundId: r.id, cells: [r.a_cells, r.b_cells], total: TOTAL, winner: r.winner } : null;
}

// A restart mid-round picks the round back up: its paint is on the volume, so
// the floor is rebuilt from it. A round that ran out while we were down is
// scored now.
{
  const open = q.openRound.get() as RoundRow | undefined;
  if (open) {
    round = open;
    for (const p of q.paintIn.all(open.id) as unknown as PaintRow[]) turf.paint(JSON.parse(p.points), p.team);
    if (Date.now() >= open.ends_at) endRound();
  } else {
    startRound();
  }
}

setInterval(() => {
  const now = Date.now();
  if (round && now >= round.ends_at) endRound(now);
  else if (!round && now >= nextAt) startRound(now);
}, 250).unref();

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

// The signed-in painter, with a team: anyone from before teams gets one here.
function withTeam(user: User): User & { team: Team } {
  if (user.team === 0 || user.team === 1) return user as User & { team: Team };
  const team = balancedTeam();
  q.setTeam.run(team, user.id);
  return { ...user, team };
}

function authed(req: IncomingMessage): (User & { team: Team }) | null {
  const m = (req.headers.authorization ?? "").match(/^Bearer (\S+)$/);
  const user = m ? (q.userBySecret.get(m[1]) as User | undefined) : undefined;
  if (!user) return null;
  const u = withTeam(user);
  touch(u);
  return u;
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
<body><main><p class="back"><a href="/">← back to the arena</a></p>${body}</main></body></html>`;
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
      const found = q.userBySecret.get(body.secret) as User | undefined;
      if (found) {
        const user = withTeam(found);
        touch(user);
        return send(res, 200, { ...user, secret: body.secret });
      }
    }
    const user = { id: randomUUID(), name: `${pick(ADJ)}-${pick(NOUN)}`, team: balancedTeam() };
    const secret = randomBytes(24).toString("base64url");
    q.insertUser.run(user.id, secret, user.name, user.team, Date.now());
    touch(user);
    return send(res, 201, { ...user, secret });
  }

  if (path === "/api/me" && method === "PATCH") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown painter" });
    const name = cleanName(((await readJson(req)) as { name?: unknown }).name);
    if (!name) return send(res, 400, { error: "name must be 1-24 characters" });
    q.rename.run(name, user.id);
    broadcast({ type: "name", id: user.id, name });
    return send(res, 200, { id: user.id, name, team: user.team });
  }

  // Everything a client needs to draw the game around the paint.
  if (path === "/api/round" && method === "GET") {
    return send(res, 200, {
      now: Date.now(),
      round: roundWire(),
      nextAt: round ? null : nextAt,
      cells: [...turf.counts],
      total: TOTAL,
      lastResult: lastResult(),
      players: players(),
      arena: ARENA,
      cell: CELL,
      roller: ROLLER,
      teams: TEAMS,
      ink: { max: INK_MAX, rate: INK_RATE },
      roundMs: ROUND_MS,
      breakMs: BREAK_MS,
    });
  }

  // The current round's paint, oldest first: drawn in order, it shows the floor
  // exactly as the grid scores it.
  if (path === "/api/strokes" && method === "GET") {
    if (!round) return send(res, 200, { roundId: null, strokes: [], names: {} });
    const strokes = (q.paintIn.all(round.id) as unknown as PaintRow[]).map(toWire);
    const names = Object.fromEntries((q.namesIn.all(round.id) as unknown as User[]).map((u) => [u.id, u.name]));
    return send(res, 200, { roundId: round.id, strokes, names });
  }

  if (path === "/api/strokes" && method === "POST") {
    const user = authed(req);
    if (!user) return send(res, 401, { error: "unknown painter" });
    if (!round) return send(res, 409, { error: "the round's over — the next one starts in a moment" });
    const parsed = parseStroke(await readJson(req));
    if (typeof parsed === "string") return send(res, 400, { error: parsed });
    if (!allow(user.id, 1 + parsed.points.length / 2000)) return send(res, 429, { error: "slow down a little" });
    const now = Date.now();
    const tank = inkOf(user.id, now);
    const cost = pathLength(parsed.points);
    if (cost > tank.ink * INK_SLACK + ROLLER) return send(res, 409, { error: "out of ink", ink: tank.ink });
    tank.ink = Math.max(0, tank.ink - cost);

    const { lastInsertRowid } = q.insertPaint.run(round.id, user.id, user.team, parsed.seed, JSON.stringify(parsed.points), now);
    turf.paint(parsed.points, user.team);
    const stroke = { id: Number(lastInsertRowid), author: user.id, team: user.team, ...parsed, createdAt: now };
    const cells = [...turf.counts];
    broadcast({ type: "stroke", stroke, name: user.name, cells });
    return send(res, 201, { ...stroke, roundId: round.id, cells, ink: tank.ink });
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
    broadcast({ type: "live", id: user.id, name: user.name, team: user.team, cursor, partial, done: body.done === true });
    return send(res, 202, { ok: true });
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
  console.log(`turf war on 0.0.0.0:${PORT}, data in ${DATA_DIR}, ${ROUND_MS / 1000}s rounds`);
});
