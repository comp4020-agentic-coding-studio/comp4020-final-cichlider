import { afterAll, describe, expect, inject, it } from "vitest";

// The wall's promises, checked against the running app. Test marks go far off
// in a corner of the wall nobody visits, and are taken back afterwards.
const baseUrl = inject("baseUrl");
const CORNER = -900_000;

interface Painter {
  id: string;
  secret: string;
  name: string;
}

const made: Array<{ who: Painter; id: number }> = [];

async function call(method: string, path: string, who?: Painter, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who.secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const painter = async (): Promise<Painter> => (await call("POST", "/api/session", undefined, {})).data;

const mark = (x: number, extra: object = {}) => ({
  tool: "pen",
  color: "#e63946",
  size: 6,
  opacity: 1,
  seed: Math.floor(Math.random() * 1e9),
  points: [CORNER + x, CORNER, CORNER + x + 40, CORNER + 30],
  ...extra,
});

async function paint(who: Painter, x: number, extra: object = {}): Promise<any> {
  const r = await call("POST", "/api/strokes", who, mark(x, extra));
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  made.push({ who, id: r.data.id });
  return r.data;
}

const around = `x0=${CORNER - 1000}&x1=${CORNER + 1000}&y0=${CORNER - 1000}&y1=${CORNER + 1000}`;

afterAll(async () => {
  for (const { who, id } of made) await call("DELETE", `/api/strokes/${id}`, who);
});

describe("a stranger leaves a trace", () => {
  it("gets a tag without signing up, and keeps it on return", async () => {
    const a = await painter();
    expect(a.name).toMatch(/\S/);
    const back = await call("POST", "/api/session", undefined, { secret: a.secret });
    expect(back.data.id).toBe(a.id);
    expect(back.data.name).toBe(a.name);
  });

  it("finds their mark still on the wall when they come back", async () => {
    const a = await painter();
    const s = await paint(a, 0);
    const later = await call("GET", `/api/strokes?${around}`);
    const found = later.data.strokes.find((t: any) => t.id === s.id);
    expect(found).toMatchObject({ author: a.id, tool: "pen", points: s.points });
    expect(later.data.names[a.id]).toBe(a.name);
  });
});

describe("the wall is shared, live", () => {
  it("shows one painter's mark to another open session within a second", async () => {
    const a = await painter();
    const ctrl = new AbortController();
    const res = await fetch(new URL("/api/events", baseUrl), { signal: ctrl.signal });
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    const seed = 424242 + Math.floor(Math.random() * 1000);

    const t0 = Date.now();
    const posted = paint(a, 200, { seed });
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
    await posted;
    expect(seenAt, "the mark never arrived on the other session's stream").toBeGreaterThan(0);
    expect(seenAt - t0).toBeLessThan(1000);
  });
});

describe("nobody can wreck anyone else's marks", () => {
  it("lets you take back your own mark, but not someone else's", async () => {
    const a = await painter();
    const b = await painter();
    const s = await paint(a, 400);
    expect((await call("DELETE", `/api/strokes/${s.id}`, b)).status).toBe(403);
    expect((await call("DELETE", `/api/strokes/${s.id}`)).status).toBe(401);
    expect((await call("DELETE", `/api/strokes/${s.id}`, a)).status).toBe(200);
    const after = await call("GET", `/api/strokes?${around}`);
    expect(after.data.strokes.some((t: any) => t.id === s.id)).toBe(false);
  });

  it("won't take a mark without a painter", async () => {
    expect((await call("POST", "/api/strokes", undefined, mark(600))).status).toBe(401);
  });

  it("refuses marks that aren't marks", async () => {
    const a = await painter();
    for (const bad of [
      mark(0, { tool: "flamethrower" }),
      mark(0, { color: "red" }),
      mark(0, { size: 9999 }),
      mark(0, { points: [1, 2, 3] }),
      mark(0, { tool: "rect", points: [0, 0, 1, 1, 2, 2] }),
      mark(0, { points: Array(4001 * 2).fill(CORNER) }),
    ]) {
      expect((await call("POST", "/api/strokes", a, bad)).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
    }
  });
});
