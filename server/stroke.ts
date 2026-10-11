// What a stroke of paint is allowed to be. The server is the only writer to
// the database, so every rule about shape and size lives here. Colour isn't
// part of a stroke: it comes from the painter's team, which the server knows.

import { ARENA } from "./grid.ts";

export const TOOLS = ["roller"] as const;
export type Tool = (typeof TOOLS)[number];

export const MAX_POINTS = 4000; // pairs, per stroke

export interface StrokeInput {
  tool: Tool;
  seed: number;
  points: number[]; // flat [x0, y0, x1, y1, ...] in arena coordinates
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Returns the cleaned stroke, or a string saying what's wrong with it.
export function parseStroke(body: unknown): StrokeInput | string {
  if (!body || typeof body !== "object") return "stroke must be an object";
  const b = body as Record<string, unknown>;

  if (!TOOLS.includes(b.tool as Tool)) return `tool must be one of ${TOOLS.join(", ")}`;
  const seed = b.seed === undefined ? 0 : b.seed;
  if (!isNum(seed) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return "seed must be a uint32";

  const pts = b.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length % 2 !== 0) return "points must be [x, y, ...] pairs";
  if (pts.length / 2 > MAX_POINTS) return `at most ${MAX_POINTS} points per stroke`;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (!isNum(x) || !isNum(y) || x < ARENA.x0 || x > ARENA.x1 || y < ARENA.y0 || y > ARENA.y1) {
      return "points must be inside the arena";
    }
  }

  return { tool: b.tool as Tool, seed, points: pts.map((p: number) => Math.round(p * 10) / 10) };
}

// How far the roller travels along a stroke: what it costs in ink.
export function pathLength(points: readonly number[]): number {
  let d = 0;
  for (let i = 0; i < points.length - 2; i += 2) d += Math.hypot(points[i + 2] - points[i], points[i + 3] - points[i + 1]);
  return d;
}

// A visitor's tag: what other people see next to their cursor.
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  return name.length > 0 ? name : null;
}
