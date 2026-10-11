import { describe, expect, it } from "vitest";
import { ARENA, CELL, COLS, FADE_MS, TOTAL, Turf } from "../server/grid.ts";

// The floor rules on their own, without a server: the last roller over a cell
// owns it (docs/decisions/0002-last-roller-wins.md), and paint nobody renews
// fades back to bare floor.
const owner = (t: Turf, x: number, y: number) =>
  t.cells[Math.floor((y - ARENA.y0) / CELL) * COLS + Math.floor((x - ARENA.x0) / CELL)];

describe("who owns the floor", () => {
  it("gives a cell to whichever team rolled over it last", () => {
    const t = new Turf();
    t.paint([-100, 0, 100, 0], 0, 0);
    expect(owner(t, 0, 0)).toBe(1);
    t.paint([-100, 0, 100, 0], 1, 10);
    expect(owner(t, 0, 0)).toBe(2);
    t.paint([0, -50, 0, 50], 0, 20);
    expect(owner(t, 0, 0)).toBe(1);
  });

  it("moves cells from one team to the other, never counting a cell twice", () => {
    const t = new Turf();
    t.paint([-300, 0, 300, 0], 0, 0);
    const painted = t.counts[0];
    expect(painted).toBeGreaterThan(0);
    t.paint([-300, 0, 300, 0], 1, 1);
    expect(t.counts).toEqual([0, painted]);
    for (let i = 0; i < 200; i++) {
      const x = ARENA.x0 + Math.random() * (ARENA.x1 - ARENA.x0), y = ARENA.y0 + Math.random() * (ARENA.y1 - ARENA.y0);
      t.paint([x, y, x + 80, y + 40], (i % 2) as 0 | 1, i);
    }
    const tally = [0, 0];
    for (const c of t.cells) if (c) tally[c - 1]++;
    expect(t.counts).toEqual(tally);
    expect(t.counts[0] + t.counts[1]).toBeLessThanOrEqual(TOTAL);
  });

  it("leaves no gaps when a roller moves a long way in one step", () => {
    const t = new Turf();
    t.paint([-700, 0, 700, 0], 0, 0);
    for (let x = -700; x <= 700; x += CELL) expect(owner(t, x, 0), `gap at x=${x}`).toBe(1);
  });
});

describe("paint fades", () => {
  it("goes back to bare floor once nobody has renewed it for the fade time", () => {
    const t = new Turf();
    t.paint([-100, 0, 100, 0], 0, 0);
    t.fade(FADE_MS - 1);
    expect(owner(t, 0, 0)).toBe(1);
    t.fade(FADE_MS);
    expect(owner(t, 0, 0)).toBe(0);
    expect(t.counts).toEqual([0, 0]);
  });

  it("starts the clock again when its own team rolls over it", () => {
    const t = new Turf();
    t.paint([-100, 0, 100, 0], 0, 0);
    t.paint([-100, 0, 100, 0], 0, FADE_MS - 5000);
    t.fade(FADE_MS + 1000);
    expect(owner(t, 0, 0)).toBe(1);
  });

  it("reports each change once, including fading", () => {
    const t = new Turf();
    t.paint([0, 0], 1, 0);
    const first = t.drain();
    expect(first.length).toBeGreaterThan(0);
    expect(t.drain()).toEqual([]);
    t.fade(FADE_MS);
    const faded = t.drain();
    expect(faded.length).toBe(first.length);
    for (let i = 1; i < faded.length; i += 2) expect(faded[i]).toBe(0);
  });

  it("comes back exactly as saved", () => {
    const t = new Turf();
    t.paint([-300, -200, 300, 200], 0, 100);
    t.paint([-300, 200, 300, -200], 1, 200);
    const u = new Turf();
    u.restore(t.cells, t.painted);
    expect(u.counts).toEqual(t.counts);
    expect([...u.painted]).toEqual([...t.painted]);
  });
});
