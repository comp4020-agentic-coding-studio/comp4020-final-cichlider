// Who owns which bit of the arena. The arena is cut into square cells; a cell
// belongs to whichever team's roller passed over it last, and fades back to bare
// floor if nobody rolls over it again for FADE_MS. Nothing blends and nothing is
// locked. Time here is the game clock (see server/main.ts), not the wall clock.
// Pure, no I/O, so the server and the spec share it.

export const ARENA = { x0: -800, y0: -500, x1: 800, y1: 500 } as const;
export const CELL = 20;
export const COLS = (ARENA.x1 - ARENA.x0) / CELL;
export const ROWS = (ARENA.y1 - ARENA.y0) / CELL;
export const TOTAL = COLS * ROWS;
export const ROLLER = 64; // width of the band a roller paints, in arena units
export const FADE_MS = 75_000;

export type Team = 0 | 1;

export class Turf {
  // 0 = bare floor, 1 = team 0, 2 = team 1
  readonly cells = new Uint8Array(TOTAL);
  // game-clock ms each cell was last rolled over
  readonly painted = new Float64Array(TOTAL);
  readonly counts: [number, number] = [0, 0];
  // cells whose owner or paint time changed since the last drain()
  private changed = new Set<number>();

  // Roll a path of [x0, y0, x1, y1, ...] for a team. Points are stamped every
  // half cell along each segment, so a fast roller still leaves no gaps.
  paint(points: readonly number[], team: Team, now: number, width = ROLLER): void {
    const r = width / 2;
    if (points.length === 2) return this.stamp(points[0], points[1], r, team, now);
    for (let i = 0; i < points.length - 2; i += 2) {
      const ax = points[i], ay = points[i + 1], bx = points[i + 2], by = points[i + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
      for (let k = 0; k <= n; k++) this.stamp(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r, team, now);
    }
  }

  // Every cell whose centre is within r of (x, y) goes to the team, freshly.
  private stamp(x: number, y: number, r: number, team: Team, now: number): void {
    const c0 = Math.max(0, Math.floor((x - r - ARENA.x0) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((x + r - ARENA.x0) / CELL));
    const r0 = Math.max(0, Math.floor((y - r - ARENA.y0) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((y + r - ARENA.y0) / CELL));
    const mark = team + 1;
    for (let row = r0; row <= r1; row++) {
      const cy = ARENA.y0 + (row + 0.5) * CELL;
      for (let col = c0; col <= c1; col++) {
        const cx = ARENA.x0 + (col + 0.5) * CELL;
        if ((cx - x) ** 2 + (cy - y) ** 2 > r * r) continue;
        const i = row * COLS + col;
        const was = this.cells[i];
        // repainting your own colour only matters once it's started to age
        if (was === mark && now - this.painted[i] < 1000) continue;
        if (was !== mark) {
          if (was) this.counts[was - 1]--;
          this.cells[i] = mark;
          this.counts[team]++;
        }
        this.painted[i] = now;
        this.changed.add(i);
      }
    }
  }

  // Paint nobody has renewed for FADE_MS goes back to bare floor.
  fade(now: number): void {
    for (let i = 0; i < TOTAL; i++) {
      const c = this.cells[i];
      if (c && now - this.painted[i] >= FADE_MS) {
        this.cells[i] = 0;
        this.counts[c - 1]--;
        this.changed.add(i);
      }
    }
  }

  // What changed since last time, as [cell, owner, ...] flat.
  drain(): number[] {
    const out: number[] = [];
    for (const i of this.changed) out.push(i, this.cells[i]);
    this.changed.clear();
    return out;
  }

  // Load a saved floor (cells and paint times) back in.
  restore(cells: Uint8Array, painted: Float64Array): void {
    this.cells.set(cells.subarray(0, TOTAL));
    this.painted.set(painted.subarray(0, TOTAL));
    this.counts[0] = this.counts[1] = 0;
    for (const c of this.cells) if (c) this.counts[c - 1]++;
  }
}
