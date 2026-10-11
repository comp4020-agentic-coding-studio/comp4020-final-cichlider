// Who owns which bit of the arena. The arena is cut into square cells; a cell
// belongs to whichever team's roller passed over it last. Nothing blends and
// nothing is locked: a later stroke simply takes the cells it covers. Pure, no
// I/O, so the server and the spec share it.

export const ARENA = { x0: -1200, y0: -700, x1: 1200, y1: 700 } as const;
export const CELL = 20;
export const COLS = (ARENA.x1 - ARENA.x0) / CELL;
export const ROWS = (ARENA.y1 - ARENA.y0) / CELL;
export const TOTAL = COLS * ROWS;
export const ROLLER = 60; // roller width, in arena units

export type Team = 0 | 1;

export class Turf {
  // 0 = bare floor, 1 = team 0, 2 = team 1
  readonly cells = new Uint8Array(TOTAL);
  readonly counts: [number, number] = [0, 0];

  // Roll a path of [x0, y0, x1, y1, ...] for a team. Points are stamped every
  // half cell along each segment, so a fast flick still leaves no gaps.
  paint(points: readonly number[], team: Team, width = ROLLER): void {
    const r = width / 2;
    if (points.length === 2) return this.stamp(points[0], points[1], r, team);
    for (let i = 0; i < points.length - 2; i += 2) {
      const ax = points[i], ay = points[i + 1], bx = points[i + 2], by = points[i + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
      for (let k = 0; k <= n; k++) this.stamp(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, r, team);
    }
  }

  // Every cell whose centre is within r of (x, y) goes to the team.
  private stamp(x: number, y: number, r: number, team: Team): void {
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
        if (was === mark) continue;
        if (was) this.counts[was - 1]--;
        this.cells[i] = mark;
        this.counts[team]++;
      }
    }
  }

  clear(): void {
    this.cells.fill(0);
    this.counts[0] = this.counts[1] = 0;
  }
}

// The team with more floor, or null for a dead heat.
export function winnerOf(counts: readonly [number, number]): Team | null {
  return counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
}
