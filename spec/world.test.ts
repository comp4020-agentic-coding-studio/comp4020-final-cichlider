import { describe, expect, it } from "vitest";
import { ARENA, Turf } from "../server/grid.ts";
import { MIN_PER_TEAM, RADIUS, SPEED, World } from "../server/world.ts";

// Rollers on their own, without a server: the five actions, the walls, and
// NPCs filling in for missing people.
function seeded(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(w: World, seconds: number, from = 0): number {
  let now = from;
  for (let i = 0; i < seconds * 20; i++) {
    now += 50;
    w.step(0.05, now);
  }
  return now;
}

describe("the five actions", () => {
  it("rolls forward along its heading, painting its colour behind it", () => {
    const w = new World(new Turf(), seeded());
    const r = w.spawn("a", 0, "a", false, 0);
    Object.assign(r, { x: -200, y: 0, h: 0 });
    w.setInput("a", 1, 0, 0);
    run(w, 1);
    expect(r.x).toBeCloseTo(-200 + SPEED, 0);
    expect(r.y).toBeCloseTo(0, 5);
    expect(w.turf.counts[0]).toBeGreaterThan(0);
    expect(w.turf.counts[1]).toBe(0);
  });

  it("turns on the spot without painting, and backs up slower than it drives", () => {
    const w = new World(new Turf(), seeded());
    const r = w.spawn("a", 1, "a", false, 0);
    Object.assign(r, { x: 0, y: 0, h: 0 });
    w.setInput("a", 0, 1, 0);
    run(w, 0.5);
    expect(r.h).toBeGreaterThan(1);
    expect(r.x).toBe(0);
    expect(w.turf.counts).toEqual([0, 0]);
    Object.assign(r, { h: 0 });
    w.setInput("a", -1, 0, 0);
    run(w, 1);
    expect(r.x).toBeLessThan(0);
    expect(-r.x).toBeLessThan(SPEED);
    expect(w.turf.counts[1]).toBeGreaterThan(0);
  });

  it("stays inside the walls and doesn't drive through other rollers", () => {
    const w = new World(new Turf(), seeded());
    const a = w.spawn("a", 0, "a", false, 0), b = w.spawn("b", 1, "b", false, 0);
    Object.assign(a, { x: -100, y: 0, h: 0 });
    Object.assign(b, { x: 100, y: 0, h: Math.PI });
    w.setInput("a", 1, 0, 0);
    w.setInput("b", 1, 0, 0);
    run(w, 2);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(RADIUS * 2 - 1);
    Object.assign(a, { x: 0, y: 0, h: -Math.PI / 2 });
    run(w, 10);
    expect(a.y).toBeGreaterThanOrEqual(ARENA.y0 + RADIUS);
  });
});

describe("NPCs", () => {
  it("fill each team up to the minimum, and step out as people join", () => {
    const w = new World(new Turf(), seeded());
    w.reconcileNpcs(0);
    const count = (team: 0 | 1, npc: boolean) => [...w.rollers.values()].filter((r) => r.team === team && r.npc === npc).length;
    expect(count(0, true)).toBe(MIN_PER_TEAM);
    expect(count(1, true)).toBe(MIN_PER_TEAM);
    w.spawn("p1", 0, "p1", false, 0);
    w.spawn("p2", 0, "p2", false, 0);
    w.reconcileNpcs(0);
    expect(count(0, true)).toBe(MIN_PER_TEAM - 2);
    expect(count(1, true)).toBe(MIN_PER_TEAM);
    w.remove("p1");
    w.reconcileNpcs(0);
    expect(count(0, true)).toBe(MIN_PER_TEAM - 1);
  });

  it("go and paint the floor on their own", () => {
    const w = new World(new Turf(), seeded(7));
    w.reconcileNpcs(0);
    run(w, 20);
    // in 20 seconds, both sides' bots have each claimed a real share of the floor
    const total = (ARENA.x1 - ARENA.x0) * (ARENA.y1 - ARENA.y0) / 400;
    expect(w.turf.counts[0] / total).toBeGreaterThan(0.08);
    expect(w.turf.counts[1] / total).toBeGreaterThan(0.08);
  });

  it("leave when their players go quiet, but bots never do", () => {
    const w = new World(new Turf(), seeded());
    w.reconcileNpcs(0);
    w.spawn("p", 1, "p", false, 0);
    w.expire(20_000, 15_000);
    expect(w.rollers.has("p")).toBe(false);
    expect(w.humans()).toBe(0);
    expect(w.rollers.size).toBe(MIN_PER_TEAM * 2);
  });
});
