import { describe, expect, inject, it } from "vitest";

// Turf war's promises, checked against the running app. Each test makes its
// own fresh players; they leave the floor on their own once they go quiet.
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
const input = (who: Player, move: number, turn: number) => call("POST", "/api/input", who, { move, turn });
const rollerOf = (state: any, id: string) => state.rollers.find((r: any[]) => r[0] === id);

// Reads the event stream until `until` says yes, or gives up after `ms`.
async function watch(until: (tick: any) => boolean, ms = 3000): Promise<number> {
  const ctrl = new AbortController();
  const res = await fetch(new URL("/api/events", baseUrl), { signal: ctrl.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const t0 = Date.now();
  let buf = "";
  try {
    while (Date.now() - t0 < ms) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "tick" && until(ev)) return Date.now();
      }
    }
    return 0;
  } finally {
    ctrl.abort();
  }
}

describe("a stranger joins in", () => {
  it("gets a tag and a team without signing up, and keeps both on return", async () => {
    const a = await player();
    expect(a.name).toMatch(/\S/);
    expect([0, 1]).toContain(a.team);
    const back = await call("POST", "/api/session", undefined, { secret: a.secret });
    expect(back.data).toMatchObject({ id: a.id, name: a.name, team: a.team });
  });

  it("joins whichever side has fewer people on the floor right now", async () => {
    const before = (await call("GET", "/api/state")).data.humans as [number, number];
    const a = await player();
    expect(before[a.team]).toBeLessThanOrEqual(before[1 - a.team]);
  });

  it("is on the floor as a roller as soon as it does anything, even stand still", async () => {
    const a = await player();
    expect((await input(a, 0, 0)).status).toBe(202);
    const s = (await call("GET", "/api/state")).data;
    expect(rollerOf(s, a.id)?.slice(0, 2)).toEqual([a.id, a.team]);
  });

  it("finds bots filling each team up to the minimum, and only up to it", async () => {
    const a = await player();
    await input(a, 0, 0);
    const s = (await call("GET", "/api/state")).data;
    for (const team of [0, 1]) {
      const humans = s.rollers.filter((r: any[]) => r[1] === team && r[6] === 0).length;
      const bots = s.rollers.filter((r: any[]) => r[1] === team && r[6] === 1).length;
      expect(bots, `team ${team} has ${humans} people`).toBe(Math.max(0, s.minPerTeam - humans));
    }
  });
});

describe("the floor is shared, live", { timeout: 10_000 }, () => {
  it("shows a roller moving to another open session within a second", async () => {
    const a = await player();
    await input(a, 0, 0);
    const start = rollerOf((await call("GET", "/api/state")).data, a.id);
    const t0 = Date.now();
    const seen = watch((tick) => {
      const r = tick.r.find((x: any[]) => x[0] === a.id);
      return r && Math.hypot(r[2] - start[2], r[3] - start[3]) > 5;
    });
    await input(a, 1, 0);
    const seenAt = await seen;
    await input(a, 0, 0);
    expect(seenAt, "the roller never moved on the other session's stream").toBeGreaterThan(0);
    expect(seenAt - t0).toBeLessThan(1000);
  });

  it("paints the player's team colour where it rolls", async () => {
    const a = await player();
    await input(a, 0, 0);
    const seen = watch((tick) => {
      for (let i = 1; i < tick.c.length; i += 2) if (tick.c[i] === a.team + 1) return true;
      return false;
    });
    await input(a, 1, 1);
    const at = await seen;
    await input(a, 0, 0);
    expect(at, "no paint in the player's colour came down the stream").toBeGreaterThan(0);
  });

  it("sends a snapshot that agrees with its own score", async () => {
    const s = (await call("GET", "/api/state")).data;
    const owners = Buffer.from(s.owners, "base64");
    const raw = Buffer.from(s.ages, "base64");
    const ages = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
    expect(owners.length).toBe(s.total);
    expect(ages.length).toBe(s.total);
    const tally = [0, 0];
    for (let i = 0; i < owners.length; i++) {
      if (!owners[i]) continue;
      tally[owners[i] - 1]++;
      expect(ages[i] * 100, "no paint is shown past its fade time").toBeLessThan(s.fadeMs + 100);
    }
    expect(tally).toEqual(s.s);
  });
});

describe("only the five actions", () => {
  it("won't move a roller without a player", async () => {
    expect((await call("POST", "/api/input", undefined, { move: 1, turn: 0 })).status).toBe(401);
  });

  it("refuses anything that isn't forward, back, left, right or still", async () => {
    const a = await player();
    for (const bad of [{ move: 2, turn: 0 }, { move: 1, turn: "left" }, { move: 1 }, { x: 0, y: 0 }, { move: 0.5, turn: 0 }]) {
      expect((await call("POST", "/api/input", a, bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});
