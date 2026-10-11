// The rollers on the wall, and how they move. Every roller, human or NPC, has
// the same five actions: forward, back, turn left, turn right, or nothing. A
// moving roller paints behind it, and the wall is upright, so now and then wet
// paint runs: a drip slides down from the roller and paints a thin line as it
// goes. NPCs decide their action the same way a player presses a key; they
// just do it in code. Pure, no I/O: the server owns the clock and calls step().

import { ARENA, CELL, COLS, ROLLER, ROWS, Turf, type Team } from "./grid.ts";

export const SPEED = 240; // forward, arena units per second
export const BACK_SPEED = 150;
export const TURN = 2.8; // radians per second
export const RADIUS = 34; // body size for bumping into walls and each other
export const MIN_PER_TEAM = 3; // NPCs fill each team up to this many rollers

// Drips: how often a moving roller lets one go, how wide a line it leaves, and
// how far it runs before it dries.
export const DRIPS_PER_SEC = 1.0;
export const DRIP_WIDTH = 14;
const DRIP_MIN = 40, DRIP_MAX = 190;
const DRIP_SPEED = 110; // when it starts; it slows as it runs out of paint

export type Move = -1 | 0 | 1; // back, still, forward
export type Turn = -1 | 0 | 1; // left, straight, right

export interface Roller {
  id: string;
  npc: boolean;
  team: Team;
  name: string;
  x: number;
  y: number;
  h: number; // heading, radians; 0 points along +x
  move: Move;
  turn: Turn;
  seenAt: number; // game clock, last input from its player
}

interface Brain {
  tx: number;
  ty: number;
  until: number;
  stuck: number; // seconds spent pushing without getting anywhere
  backUntil: number;
}

export interface Drip {
  x: number;
  y: number;
  team: Team;
  left: number; // how much further it can run
  total: number;
}

const NPC_NAMES = ["bot-otter", "bot-squid", "bot-kelp", "bot-urchin", "bot-shrimp", "bot-eel", "bot-krill", "bot-clam"];

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class World {
  readonly rollers = new Map<string, Roller>();
  readonly drips: Drip[] = [];
  private brains = new Map<string, Brain>();
  private npcCount = 0;

  readonly turf: Turf;
  private rand: () => number;

  // (plain fields, not parameter properties: node only strips types, it doesn't compile)
  constructor(turf: Turf, rand: () => number = Math.random) {
    this.turf = turf;
    this.rand = rand;
  }

  // A roller starts on its own team's side, facing the middle.
  spawn(id: string, team: Team, name: string, npc: boolean, now: number): Roller {
    const side = team === 0 ? -1 : 1;
    const r: Roller = {
      id, npc, team, name,
      x: side * (ARENA.x1 - 140 - this.rand() * 160),
      y: (this.rand() - 0.5) * (ARENA.y1 - ARENA.y0 - 200),
      h: team === 0 ? 0 : Math.PI,
      move: 0, turn: 0, seenAt: now,
    };
    this.rollers.set(id, r);
    return r;
  }

  setInput(id: string, move: Move, turn: Turn, now: number): void {
    const r = this.rollers.get(id);
    if (!r) return;
    r.move = move;
    r.turn = turn;
    r.seenAt = now;
  }

  humans(team?: Team): number {
    let n = 0;
    for (const r of this.rollers.values()) if (!r.npc && (team === undefined || r.team === team)) n++;
    return n;
  }

  // Top each team up to MIN_PER_TEAM with NPCs, and send NPCs home as people arrive.
  reconcileNpcs(now: number): void {
    for (const team of [0, 1] as const) {
      const npcs = [...this.rollers.values()].filter((r) => r.npc && r.team === team);
      const want = Math.max(0, MIN_PER_TEAM - this.humans(team));
      for (let i = npcs.length; i < want; i++) {
        const id = `npc-${++this.npcCount}`;
        this.spawn(id, team, NPC_NAMES[this.npcCount % NPC_NAMES.length], true, now);
      }
      for (const r of npcs.slice(want)) this.remove(r.id);
    }
  }

  remove(id: string): void {
    this.rollers.delete(id);
    this.brains.delete(id);
  }

  // Players who stopped sending input (closed the tab) leave the floor.
  expire(now: number, idleMs: number): void {
    for (const r of this.rollers.values()) if (!r.npc && now - r.seenAt > idleMs) this.remove(r.id);
  }

  step(dt: number, now: number): void {
    const before = new Map<string, [number, number]>();
    for (const r of this.rollers.values()) {
      if (r.npc) this.think(r, dt, now);
      before.set(r.id, [r.x, r.y]);
      r.h = wrap(r.h + r.turn * TURN * dt);
      const v = r.move > 0 ? SPEED : r.move < 0 ? -BACK_SPEED : 0;
      r.x += Math.cos(r.h) * v * dt;
      r.y += Math.sin(r.h) * v * dt;
    }
    this.collide();
    for (const r of this.rollers.values()) {
      const [ox, oy] = before.get(r.id)!;
      if (r.move === 0 || Math.hypot(r.x - ox, r.y - oy) <= 0.5) continue;
      this.turf.paint([ox, oy, r.x, r.y], r.team, now);
      if (this.rand() < DRIPS_PER_SEC * dt) this.drip(r);
    }
    this.runDrips(dt, now);
  }

  // A drip leaves from somewhere along the drum's width.
  private drip(r: Roller): void {
    const u = (this.rand() - 0.5) * ROLLER * 0.9;
    const total = DRIP_MIN + this.rand() * (DRIP_MAX - DRIP_MIN);
    this.drips.push({ x: r.x - Math.sin(r.h) * u, y: r.y + Math.cos(r.h) * u + ROLLER * 0.3, team: r.team, left: total, total });
  }

  // Each drip runs straight down, fast at first and slowing as it thins out,
  // painting its team's colour, until it dries or reaches the bottom.
  private runDrips(dt: number, now: number): void {
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      const dy = Math.min(d.left, DRIP_SPEED * (0.25 + 0.75 * (d.left / d.total)) * dt);
      const y = Math.min(ARENA.y1, d.y + dy);
      this.turf.paint([d.x, d.y, d.x, y], d.team, now, DRIP_WIDTH);
      d.left -= dy;
      d.y = y;
      if (d.left <= 0.5 || d.y >= ARENA.y1) this.drips.splice(i, 1);
    }
  }

  // Rollers push each other apart and stay inside the walls.
  private collide(): void {
    const list = [...this.rollers.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
        if (d >= RADIUS * 2) continue;
        const push = (RADIUS * 2 - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
    for (const r of list) {
      r.x = Math.max(ARENA.x0 + RADIUS, Math.min(ARENA.x1 - RADIUS, r.x));
      r.y = Math.max(ARENA.y0 + RADIUS, Math.min(ARENA.y1 - RADIUS, r.y));
    }
  }

  // An NPC heads for floor that isn't its colour yet, turning until it faces
  // the spot, and backs off when it's pinned against a wall or another roller.
  private think(r: Roller, dt: number, now: number): void {
    let b = this.brains.get(r.id);
    if (!b) {
      b = { tx: r.x, ty: r.y, until: 0, stuck: 0, backUntil: 0 };
      this.brains.set(r.id, b);
    }
    if (now < b.backUntil) {
      r.move = -1;
      return;
    }
    if (now >= b.until || Math.hypot(b.tx - r.x, b.ty - r.y) < 40) this.retarget(r, b, now);
    const diff = wrap(Math.atan2(b.ty - r.y, b.tx - r.x) - r.h);
    r.turn = diff > 0.12 ? 1 : diff < -0.12 ? -1 : 0;
    r.move = Math.abs(diff) > 1.8 ? 0 : 1;

    const pinned = r.move > 0 && (
      r.x <= ARENA.x0 + RADIUS + 1 || r.x >= ARENA.x1 - RADIUS - 1 ||
      r.y <= ARENA.y0 + RADIUS + 1 || r.y >= ARENA.y1 - RADIUS - 1 ||
      [...this.rollers.values()].some((o) => o !== r && Math.hypot(o.x - r.x, o.y - r.y) < RADIUS * 2.05)
    );
    b.stuck = pinned ? b.stuck + dt : 0;
    if (b.stuck > 0.6) {
      b.stuck = 0;
      b.backUntil = now + 500;
      b.until = 0; // pick somewhere else once clear
    }
  }

  // Look at a handful of random spots and go for the nearest one that isn't ours.
  private retarget(r: Roller, b: Brain, now: number): void {
    let best: [number, number] | null = null, bestScore = Infinity;
    for (let k = 0; k < 14; k++) {
      const col = Math.floor(this.rand() * COLS), row = Math.floor(this.rand() * ROWS);
      if (this.turf.cells[row * COLS + col] === r.team + 1) continue;
      const x = ARENA.x0 + (col + 0.5) * CELL, y = ARENA.y0 + (row + 0.5) * CELL;
      const score = Math.hypot(x - r.x, y - r.y) * (0.6 + this.rand() * 0.8);
      if (score < bestScore) { bestScore = score; best = [x, y]; }
    }
    if (!best) best = [ARENA.x0 + this.rand() * (ARENA.x1 - ARENA.x0), ARENA.y0 + this.rand() * (ARENA.y1 - ARENA.y0)];
    // keep the target where a roller can actually reach it
    b.tx = Math.max(ARENA.x0 + ROLLER, Math.min(ARENA.x1 - ROLLER, best[0]));
    b.ty = Math.max(ARENA.y0 + ROLLER, Math.min(ARENA.y1 - ROLLER, best[1]));
    b.until = now + 3000 + this.rand() * 3000;
  }
}
