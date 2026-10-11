import { describe, expect, it } from "vitest";
import { ARENA, CELL, COLS, TOTAL, Turf, winnerOf } from "../server/grid.ts";

// The ownership rule on its own, without a server: the last roller over a cell
// owns it. This is the decision in docs/decisions/0002-last-roller-wins.md.
const owner = (t: Turf, x: number, y: number) =>
  t.cells[Math.floor((y - ARENA.y0) / CELL) * COLS + Math.floor((x - ARENA.x0) / CELL)];

describe("who owns the floor", () => {
  it("gives a cell to whichever team rolled over it last", () => {
    const t = new Turf();
    t.paint([-100, 0, 100, 0], 0);
    expect(owner(t, 0, 0)).toBe(1);
    t.paint([-100, 0, 100, 0], 1);
    expect(owner(t, 0, 0)).toBe(2);
    t.paint([0, -50, 0, 50], 0);
    expect(owner(t, 0, 0)).toBe(1);
  });

  it("moves cells from one team to the other, never counting a cell twice", () => {
    const t = new Turf();
    t.paint([-300, 0, 300, 0], 0);
    const painted = t.counts[0];
    expect(painted).toBeGreaterThan(0);
    expect(t.counts[1]).toBe(0);
    t.paint([-300, 0, 300, 0], 1);
    expect(t.counts).toEqual([0, painted]);
    for (let i = 0; i < 200; i++) {
      const x = ARENA.x0 + Math.random() * (ARENA.x1 - ARENA.x0), y = ARENA.y0 + Math.random() * (ARENA.y1 - ARENA.y0);
      t.paint([x, y, x + 80, y + 40], (i % 2) as 0 | 1);
    }
    const tally = [0, 0];
    for (const c of t.cells) if (c) tally[c - 1]++;
    expect(t.counts).toEqual(tally);
    expect(t.counts[0] + t.counts[1]).toBeLessThanOrEqual(TOTAL);
  });

  it("leaves no gaps when a stroke is a fast flick between far-apart points", () => {
    const t = new Turf();
    t.paint([-1000, 0, 1000, 0], 0);
    for (let x = -1000; x <= 1000; x += CELL) expect(owner(t, x, 0), `gap at x=${x}`).toBe(1);
  });

  it("stays on the floor at the edges", () => {
    const t = new Turf();
    t.paint([ARENA.x0, ARENA.y0, ARENA.x1, ARENA.y0], 1);
    expect(t.counts[1]).toBeGreaterThan(0);
    expect(t.counts[1]).toBeLessThan(TOTAL);
  });

  it("names the team with more floor, or nobody on a tie", () => {
    expect(winnerOf([10, 3])).toBe(0);
    expect(winnerOf([3, 10])).toBe(1);
    expect(winnerOf([5, 5])).toBe(null);
  });
});
