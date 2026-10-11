import { describe, expect, inject, it } from "vitest";

// Turf war's promises, checked against the running app. Every test makes its
// own fresh players, so each starts with a full tank.
const baseUrl = inject("baseUrl");

interface Player {
  id: string;
  secret: string;
  name: string;
  team: 0 | 1;
}

async function call(method: string, path: string, who?: Player, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who.secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const player = async (): Promise<Player> => (await call("POST", "/api/session", undefined, {})).data;

// One player from each side. Newcomers join the smaller side, so a few tries
// is plenty.
async function rivals(): Promise<[Player, Player]> {
  const a = await player();
  for (let i = 0; i < 8; i++) {
    const b = await player();
    if (b.team !== a.team) return [a, b];
  }
  throw new Error("couldn't get two players on different teams");
}

const roll = (points: number[], extra: object = {}) => ({
  tool: "roller",
  seed: Math.floor(Math.random() * 1e9),
  points,
  ...extra,
});

// The tests only paint while a round is on; if they land at the end of one,
// they wait out the break for the next, so these get longer than vitest's 5s.
const WAIT = 30_000;
async function liveRound(): Promise<any> {
  for (let i = 0; i < 50; i++) {
    const r = await call("GET", "/api/round");
    if (r.data.round && r.data.round.endsAt - r.data.now > 5000) return r.data;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error("no round started within 25s");
}

describe("a stranger joins in", () => {
  it("gets a tag and a team without signing up, and keeps both on return", async () => {
    const a = await player();
    expect(a.name).toMatch(/\S/);
    expect([0, 1]).toContain(a.team);
    const back = await call("POST", "/api/session", undefined, { secret: a.secret });
    expect(back.data).toMatchObject({ id: a.id, name: a.name, team: a.team });
  });

  it("joins whichever side has fewer players right now", async () => {
    const before = (await call("GET", "/api/round")).data.players as [number, number];
    const a = await player();
    expect(before[a.team]).toBeLessThanOrEqual(before[1 - a.team]);
  });
});

describe("the floor is shared, live", { timeout: WAIT }, () => {
  it("shows one player's paint to everyone else in this round", async () => {
    const g = await liveRound();
    const a = await player();
    const r = await call("POST", "/api/strokes", a, roll([-900, -600, -700, -600]));
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const later = await call("GET", "/api/strokes");
    expect(later.data.roundId).toBe(g.round.id);
    expect(later.data.strokes.find((s: any) => s.id === r.data.id)).toMatchObject({ author: a.id, team: a.team });
  });

  it("reaches another open session within a second", async () => {
    await liveRound();
    const a = await player();
    const ctrl = new AbortController();
    const res = await fetch(new URL("/api/events", baseUrl), { signal: ctrl.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    const seed = 424242 + Math.floor(Math.random() * 1000);

    const t0 = Date.now();
    const posted = call("POST", "/api/strokes", a, roll([-900, 600, -700, 600], { seed }));
    let buf = "";
    let seenAt = 0;
    while (!seenAt && Date.now() - t0 < 3000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      for (const line of buf.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "stroke" && ev.stroke.seed === seed) seenAt = Date.now();
      }
    }
    ctrl.abort();
    expect((await posted).status).toBe(201);
    expect(seenAt, "the paint never arrived on the other session's stream").toBeGreaterThan(0);
    expect(seenAt - t0).toBeLessThan(1000);
  });
});

describe("the last roller wins", { timeout: WAIT }, () => {
  it("hands a strip of floor to the team that rolled over it last", async () => {
    await liveRound();
    const [a, b] = await rivals();
    const strip = [600, -300, 1000, -300];
    const first = await call("POST", "/api/strokes", a, roll(strip));
    const second = await call("POST", "/api/strokes", b, roll(strip));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.data.roundId, "a round ended mid-test").toBe(first.data.roundId);
    // b took the strip off a: a lost cells, b gained them
    expect(second.data.cells[a.team]).toBeLessThan(first.data.cells[a.team]);
    expect(second.data.cells[b.team]).toBeGreaterThan(first.data.cells[b.team]);
  });

  it("paints in the team's colour, whatever colour the client asks for", async () => {
    await liveRound();
    const a = await player();
    const r = await call("POST", "/api/strokes", a, roll([0, 400, 100, 400], { color: "#000000", team: 1 - a.team }));
    expect(r.status).toBe(201);
    expect(r.data.team).toBe(a.team);
    expect(r.data.color).toBeUndefined();
  });
});

describe("nobody can flood the floor", { timeout: WAIT }, () => {
  it("refuses a stroke longer than a full tank of ink", async () => {
    const g = await liveRound();
    const a = await player();
    const { x0, x1 } = g.arena;
    const zigzag = [x0, 0, x1, 0, x0, 50, x1, 50]; // ~7200 units, a full tank is far less
    const r = await call("POST", "/api/strokes", a, roll(zigzag));
    expect(r.status).toBe(409);
    expect(r.data.error).toMatch(/ink/);
  });

  it("won't take paint without a player", async () => {
    expect((await call("POST", "/api/strokes", undefined, roll([0, 0, 10, 0]))).status).toBe(401);
  });

  it("refuses paint that isn't a roller stroke on the floor", async () => {
    await liveRound();
    const a = await player();
    for (const bad of [
      roll([0, 0, 10, 0], { tool: "flamethrower" }),
      roll([0, 0, 10, 0], { tool: "pen" }),
      roll([1, 2, 3]),
      roll([0, 0, 99999, 0]),
      roll(Array(4001 * 2).fill(0)),
    ]) {
      expect((await call("POST", "/api/strokes", a, bad)).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
  });
});

describe("rounds", () => {
  it("is either mid-round with time on the clock, or between rounds with a result to show", async () => {
    const g = (await call("GET", "/api/round")).data;
    expect(g.teams).toHaveLength(2);
    if (g.round) {
      expect(g.round.endsAt).toBeGreaterThan(g.now);
      expect(g.round.endsAt - g.round.startedAt).toBe(g.roundMs);
      expect(g.cells[0] + g.cells[1]).toBeLessThanOrEqual(g.total);
    } else {
      expect(g.nextAt).toBeGreaterThan(g.now);
      expect(g.lastResult).not.toBeNull();
    }
  });
});
