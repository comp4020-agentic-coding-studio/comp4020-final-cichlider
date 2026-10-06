// How a stroke looks. Every client draws the same stored stroke the same way,
// so anything random (the spray) comes from the stroke's own seed.

export const WALL = "#ebe6dc";

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function boundsOf(s) {
  const pad = s.tool === "spray" ? s.size * 1.5 : s.size / 2;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const p = s.points;
  for (let i = 0; i < p.length; i += 2) {
    if (p[i] < minx) minx = p[i];
    if (p[i] > maxx) maxx = p[i];
    if (p[i + 1] < miny) miny = p[i + 1];
    if (p[i + 1] > maxy) maxy = p[i + 1];
  }
  return { minx: minx - pad, miny: miny - pad, maxx: maxx + pad, maxy: maxy + pad };
}

function smoothPath(ctx, p) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (p.length === 2) {
    ctx.lineTo(p[0] + 0.01, p[1]);
    return;
  }
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
    ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
}

// The brush thins as it moves fast and swells when it lingers, so it's drawn
// as one filled outline rather than a line of fixed width.
function brush(ctx, s) {
  const p = s.points, n = p.length / 2;
  if (n < 2) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const w = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = Math.min(i + 1, n - 1), k = Math.max(i - 1, 0);
    const d = Math.hypot(p[j * 2] - p[k * 2], p[j * 2 + 1] - p[k * 2 + 1]) / Math.max(1, j - k);
    w[i] = s.size * Math.max(0.2, Math.min(1.15, 1.25 - d / (s.size * 1.2)));
  }
  // ease the tips in and out
  for (let i = 0; i < Math.min(4, n); i++) {
    const f = 0.35 + 0.65 * (i / 4);
    w[i] *= f;
    w[n - 1 - i] *= f;
  }
  const left = [], right = [];
  for (let i = 0; i < n; i++) {
    const j = Math.min(i + 1, n - 1), k = Math.max(i - 1, 0);
    let dx = p[j * 2] - p[k * 2], dy = p[j * 2 + 1] - p[k * 2 + 1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const h = w[i] / 2;
    left.push(p[i * 2] - dy * h, p[i * 2 + 1] + dx * h);
    right.push(p[i * 2] + dy * h, p[i * 2 + 1] - dx * h);
  }
  ctx.beginPath();
  ctx.moveTo(left[0], left[1]);
  for (let i = 2; i < left.length; i += 2) ctx.lineTo(left[i], left[i + 1]);
  for (let i = right.length - 2; i >= 0; i -= 2) ctx.lineTo(right[i], right[i + 1]);
  ctx.closePath();
  ctx.fill();
  for (const i of [0, n - 1]) {
    ctx.beginPath();
    ctx.arc(p[i * 2], p[i * 2 + 1], w[i] / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function spray(ctx, s) {
  const rand = mulberry32(s.seed);
  const p = s.points;
  const r = s.size;
  const dots = Math.max(8, Math.min(70, Math.round(r * 0.8)));
  const dot = Math.max(0.6, r / 28);
  ctx.beginPath();
  // a dense core with a soft fringe, like a real can held a hand's width away
  for (let i = 0; i < p.length; i += 2) {
    for (let d = 0; d < dots; d++) {
      const a = rand() * Math.PI * 2;
      const rr = r * Math.pow(rand(), 0.75) * (rand() < 0.15 ? 1.4 : 1);
      const x = p[i] + Math.cos(a) * rr, y = p[i + 1] + Math.sin(a) * rr;
      ctx.moveTo(x + dot, y);
      ctx.arc(x, y, dot * (0.6 + rand() * 0.8), 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

export function drawStroke(ctx, s) {
  const p = s.points;
  ctx.save();
  ctx.globalAlpha = s.opacity;
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = s.size;
  switch (s.tool) {
    case "pen":
      smoothPath(ctx, p);
      ctx.stroke();
      break;
    case "marker":
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = s.opacity * 0.55;
      ctx.lineCap = "square";
      ctx.lineJoin = "bevel";
      smoothPath(ctx, p);
      ctx.stroke();
      break;
    case "buff":
      ctx.globalAlpha = 1;
      ctx.strokeStyle = WALL;
      smoothPath(ctx, p);
      ctx.stroke();
      break;
    case "brush":
      brush(ctx, s);
      break;
    case "spray":
      spray(ctx, s);
      break;
    case "line":
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.stroke();
      break;
    case "rect": {
      const x = Math.min(p[0], p[2]), y = Math.min(p[1], p[3]);
      const w = Math.abs(p[2] - p[0]), h = Math.abs(p[3] - p[1]);
      ctx.lineJoin = "miter";
      if (s.fill) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x, y, w, h);
      break;
    }
    case "ellipse": {
      const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.abs(p[2] - p[0]) / 2, Math.abs(p[3] - p[1]) / 2, 0, 0, Math.PI * 2);
      if (s.fill) ctx.fill();
      else ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Is wall point (x, y) on this stroke, give or take `slack` wall units?
export function hits(s, x, y, slack) {
  const b = s.bounds;
  if (x < b.minx - slack || x > b.maxx + slack || y < b.miny - slack || y > b.maxy + slack) return false;
  const p = s.points;
  const reach = (s.tool === "spray" ? s.size : s.size / 2) + slack;
  if (s.tool === "rect" || s.tool === "ellipse") {
    const x0 = Math.min(p[0], p[2]), x1 = Math.max(p[0], p[2]), y0 = Math.min(p[1], p[3]), y1 = Math.max(p[1], p[3]);
    if (s.tool === "rect") {
      if (s.fill) return x >= x0 - slack && x <= x1 + slack && y >= y0 - slack && y <= y1 + slack;
      const corners = [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
      for (let i = 0; i < 8; i += 2) if (segDist(x, y, corners[i], corners[i + 1], corners[i + 2], corners[i + 3]) <= reach) return true;
      return false;
    }
    const rx = (x1 - x0) / 2 || 1, ry = (y1 - y0) / 2 || 1;
    const k = Math.hypot((x - (x0 + rx)) / rx, (y - (y0 + ry)) / ry);
    if (s.fill) return k <= 1 + slack / Math.min(rx, ry);
    return Math.abs(k - 1) * Math.min(rx, ry) <= reach;
  }
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i < p.length - 2; i += 2) {
    if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

// A steady colour per painter, for their dot in the list and their cursor.
export function hueOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 75% 50%)`;
}
