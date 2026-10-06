// Paints the first marks on an empty wall, through the same API as everyone
// else, under the tag "claude" — so they're ordinary marks anyone can hide.
//
//   APP_URL=https://comp4020-final-cichlider.fly.dev node scripts/seed.ts

const APP = process.env.APP_URL ?? "http://localhost:8080";
type P = [number, number];

const session = await (await fetch(`${APP}/api/session`, { method: "POST", body: "{}" })).json();
await fetch(`${APP}/api/me`, {
  method: "PATCH",
  headers: { authorization: `Bearer ${session.secret}` },
  body: JSON.stringify({ name: "claude" }),
});

let count = 0;
async function mark(s: Record<string, unknown>): Promise<void> {
  const body = { opacity: 1, seed: Math.floor(Math.random() * 2 ** 32), ...s };
  for (;;) {
    const r = await fetch(`${APP}/api/strokes`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); continue; }
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    count++;
    return;
  }
}

// Points every `step` units along a polyline, with a little hand wobble.
function along(pts: P[], step = 8, wobble = 1.5): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push(ax + (bx - ax) * t + (Math.random() - 0.5) * wobble, ay + (by - ay) * t + (Math.random() - 0.5) * wobble);
    }
  }
  const [lx, ly] = pts[pts.length - 1];
  out.push(lx, ly);
  return out;
}

const circle = (cx: number, cy: number, r: number, n = 48, a0 = 0, a1 = Math.PI * 2): P[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as P;
  });

// ---------------------------------------------------------------- the tag

// Letters in a 0.7 × 1 box.
const LETTERS: Record<string, P[][]> = {
  T: [[[0, 0], [0.7, 0]], [[0.35, 0], [0.35, 1]]],
  H: [[[0, 0], [0, 1]], [[0.7, 0], [0.7, 1]], [[0, 0.5], [0.7, 0.5]]],
  E: [[[0.7, 0], [0, 0], [0, 1], [0.7, 1]], [[0, 0.5], [0.55, 0.5]]],
  W: [[[0, 0], [0.14, 1], [0.35, 0.35], [0.56, 1], [0.7, 0]]],
  A: [[[0, 1], [0.35, 0], [0.7, 1]], [[0.15, 0.62], [0.55, 0.62]]],
  L: [[[0, 0], [0, 1], [0.7, 1]]],
};
const FILLS = ["#ff4d2e", "#ff7a00", "#ffd60a", "#2ec4b6", "#3a86ff", "#8338ec", "#ff5fa2"];

async function tag(word: string, x0: number, y0: number, h: number): Promise<void> {
  const glyphs: P[][][] = [];
  let x = x0;
  for (const ch of word) {
    if (ch === " ") { x += h * 0.5; continue; }
    // a slight forward lean and a bounce, like it was sprayed in one go
    const bounce = (glyphs.length % 2 ? -1 : 1) * h * 0.06;
    glyphs.push(LETTERS[ch].map((line) => line.map(([u, v]) => [x + u * h + (1 - v) * h * 0.18, y0 + bounce + v * h] as P)));
    x += h * 0.95;
  }
  // a cloud of spray behind the whole word
  for (let i = 0; i < 6; i++) {
    const cx = x0 + ((x - x0) * (i + 0.5)) / 6;
    await mark({ tool: "spray", color: i % 2 ? "#ff5fa2" : "#8338ec", size: h * 0.35, opacity: 0.55, points: along(circle(cx, y0 + h / 2, h * 0.4, 10), 30, 10) });
  }
  for (const g of glyphs) for (const line of g) await mark({ tool: "pen", color: "#1d1b19", size: h * 0.26, points: along(line) });
  for (const [i, g] of glyphs.entries()) for (const line of g) await mark({ tool: "pen", color: FILLS[i % FILLS.length], size: h * 0.16, points: along(line) });
  for (const g of glyphs) for (const line of g) {
    await mark({ tool: "pen", color: "#ffffff", size: h * 0.03, opacity: 0.85, points: along(line.map(([px, py]) => [px - h * 0.04, py - h * 0.04] as P)) });
  }
  // drips
  for (const [i, g] of glyphs.entries()) {
    if (i % 2) continue;
    const [bx, by] = g[0][g[0].length - 1];
    const len = h * (0.2 + Math.random() * 0.35);
    await mark({ tool: "pen", color: FILLS[i % FILLS.length], size: h * 0.05, points: along([[bx, by], [bx + 2, by + len]]) });
    await mark({ tool: "pen", color: FILLS[i % FILLS.length], size: h * 0.09, points: [bx + 2, by + len] });
  }
}

// ---------------------------------------------------------------- odds and ends

async function star(cx: number, cy: number, r: number, color: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 4;
    await mark({ tool: "line", color, size: Math.max(3, r / 6), points: [cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r] });
  }
}

async function sun(cx: number, cy: number, r: number): Promise<void> {
  await mark({ tool: "spray", color: "#ff7a00", size: r * 0.5, opacity: 0.5, points: along(circle(cx, cy, r * 1.15, 16), 25, 6) });
  await mark({ tool: "ellipse", color: "#ffd60a", size: 8, fill: true, points: [cx - r, cy - r, cx + r, cy + r] });
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    await mark({ tool: "brush", color: "#ff7a00", size: 22, points: along([[cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3], [cx + Math.cos(a) * r * 1.85, cy + Math.sin(a) * r * 1.85]], 6) });
  }
  await mark({ tool: "pen", color: "#1d1b19", size: 14, points: [cx - r * 0.35, cy - r * 0.2] });
  await mark({ tool: "pen", color: "#1d1b19", size: 14, points: [cx + r * 0.35, cy - r * 0.2] });
  await mark({ tool: "pen", color: "#1d1b19", size: 9, points: along(circle(cx, cy + r * 0.05, r * 0.45, 20, 0.2 * Math.PI, 0.8 * Math.PI)) });
}

async function flower(cx: number, cy: number, r: number, petal: string): Promise<void> {
  await mark({ tool: "brush", color: "#6a994e", size: r * 0.25, points: along([[cx, cy], [cx + r * 0.2, cy + r * 1.5], [cx - r * 0.1, cy + r * 3]], 7) });
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3, px = cx + Math.cos(a) * r * 0.7, py = cy + Math.sin(a) * r * 0.7;
    await mark({ tool: "ellipse", color: petal, size: 4, fill: true, opacity: 0.85, points: [px - r * 0.45, py - r * 0.45, px + r * 0.45, py + r * 0.45] });
  }
  await mark({ tool: "ellipse", color: "#ffd60a", size: 4, fill: true, points: [cx - r * 0.35, cy - r * 0.35, cx + r * 0.35, cy + r * 0.35] });
}

async function arrow(x: number, y: number, len: number, color: string, label?: string): Promise<void> {
  const pts: P[] = Array.from({ length: 30 }, (_, i) => [x + (len * i) / 29, y + Math.sin((i / 29) * Math.PI * 2) * 30] as P);
  await mark({ tool: "brush", color, size: 26, points: along(pts, 9) });
  const [ex, ey] = pts[pts.length - 1];
  await mark({ tool: "pen", color, size: 18, points: along([[ex - 60, ey - 50], [ex, ey], [ex - 60, ey + 50]]) });
  if (label) await mark({ tool: "marker", color, size: 20, points: along([[x, y + 80], [x + len * 0.8, y + 80]]) });
}

async function waves(x0: number, y0: number): Promise<void> {
  const blues = ["#3a86ff", "#2ec4b6", "#1d3557", "#48cae4"];
  for (let row = 0; row < 7; row++) {
    const pts: P[] = [];
    for (let i = 0; i <= 60; i++) pts.push([x0 + i * 22, y0 + row * 55 + Math.sin(i / 4 + row) * 28]);
    // uneven spacing makes the brush swell and thin
    const p = along(pts, 6 + (row % 3) * 4, 2);
    await mark({ tool: "brush", color: blues[row % blues.length], size: 30, points: p });
  }
}

async function checker(x0: number, y0: number): Promise<void> {
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    if ((i + j) % 2) continue;
    await mark({ tool: "rect", color: j % 3 === 0 ? "#e63946" : "#1d1b19", size: 4, fill: true, points: [x0 + i * 70, y0 + j * 70, x0 + i * 70 + 70, y0 + j * 70 + 70] });
  }
  await mark({ tool: "rect", color: "#1d1b19", size: 10, points: [x0 - 10, y0 - 10, x0 + 430, y0 + 430] });
}

// ---------------------------------------------------------------- the wall

console.log(`painting on ${APP} as ${session.id}`);

// the middle: the welcome tag
await tag("THE WALL", -820, -170, 220);
await arrow(-250, 330, 520, "#1d1b19");
for (const [sx, sy, r, c] of [[-1000, -330, 40, "#ffd60a"], [980, -360, 55, "#ff5fa2"], [-1060, 260, 30, "#2ec4b6"], [1080, 220, 36, "#ffd60a"], [420, -420, 26, "#3a86ff"]] as const) {
  await star(sx, sy, r, c);
}
await sun(1600, -820, 130);

// further out, so there's somewhere to wander to
await flower(4600, 2600, 70, "#ff5fa2");
await flower(4850, 2700, 55, "#8338ec");
await flower(5100, 2580, 80, "#ff7a00");
await mark({ tool: "spray", color: "#6a994e", size: 60, opacity: 0.6, points: along([[4400, 2850], [5400, 2850]], 30, 20) });
await waves(-6400, -2700);
await checker(3000, -5200);

console.log(`done: ${count} marks`);
