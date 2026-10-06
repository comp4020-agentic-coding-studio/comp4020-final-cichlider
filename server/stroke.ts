// What a stroke on the wall is allowed to be. The server is the only writer to
// the database, so every rule about shape and size lives here.

export const TOOLS = ["pen", "marker", "brush", "spray", "buff", "line", "rect", "ellipse"] as const;
export type Tool = (typeof TOOLS)[number];

// Shapes are two points (corner to corner); everything else is a freehand path.
const SHAPES: readonly Tool[] = ["line", "rect", "ellipse"];

export const MAX_POINTS = 4000; // pairs, per stroke
export const MAX_SIZE = 240;
// The wall is big but not unbounded: far enough that nobody runs out of space,
// close enough that a coordinate stays an ordinary number.
export const WORLD = 1_000_000;

export interface StrokeInput {
  tool: Tool;
  color: string;
  size: number;
  opacity: number;
  fill: boolean;
  seed: number;
  points: number[]; // flat [x0, y0, x1, y1, ...] in wall coordinates
}

export interface Bounds {
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Returns the cleaned stroke, or a string saying what's wrong with it.
export function parseStroke(body: unknown): StrokeInput | string {
  if (!body || typeof body !== "object") return "stroke must be an object";
  const b = body as Record<string, unknown>;

  if (!TOOLS.includes(b.tool as Tool)) return `tool must be one of ${TOOLS.join(", ")}`;
  const tool = b.tool as Tool;
  if (typeof b.color !== "string" || !/^#[0-9a-f]{6}$/i.test(b.color)) return "color must be #rrggbb";
  if (!isNum(b.size) || b.size < 1 || b.size > MAX_SIZE) return `size must be 1-${MAX_SIZE}`;
  const opacity = b.opacity === undefined ? 1 : b.opacity;
  if (!isNum(opacity) || opacity < 0.05 || opacity > 1) return "opacity must be 0.05-1";
  const seed = b.seed === undefined ? 0 : b.seed;
  if (!isNum(seed) || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return "seed must be a uint32";

  const pts = b.points;
  if (!Array.isArray(pts) || pts.length < 2 || pts.length % 2 !== 0) return "points must be [x, y, ...] pairs";
  if (pts.length / 2 > MAX_POINTS) return `at most ${MAX_POINTS} points per stroke`;
  if (SHAPES.includes(tool) && pts.length !== 4) return `${tool} takes exactly two points`;
  if (!pts.every((p) => isNum(p) && Math.abs(p) <= WORLD)) return `points must be numbers within ±${WORLD}`;

  return {
    tool,
    color: b.color.toLowerCase(),
    size: Math.round(b.size * 10) / 10,
    opacity: Math.round(opacity * 100) / 100,
    fill: b.fill === true && (tool === "rect" || tool === "ellipse"),
    seed,
    points: pts.map((p: number) => Math.round(p * 10) / 10),
  };
}

// The box the stroke paints into, padded by its width (spray reaches further).
export function boundsOf(s: StrokeInput): Bounds {
  const pad = s.tool === "spray" ? s.size * 1.5 : s.size / 2;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i < s.points.length; i += 2) {
    const x = s.points[i], y = s.points[i + 1];
    if (x < minx) minx = x;
    if (x > maxx) maxx = x;
    if (y < miny) miny = y;
    if (y > maxy) maxy = y;
  }
  return { minx: minx - pad, miny: miny - pad, maxx: maxx + pad, maxy: maxy + pad };
}

// A visitor's tag: what other people see next to their marks.
export function cleanName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const name = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  return name.length > 0 ? name : null;
}
