// How the floor and the rollers look, in 2.5D: a 2:1 isometric view of a floor
// slab, with each roller drawn as a lying cylinder on a handle. The floor's
// paint comes straight from the server's grid, one pixel per cell, scaled up
// smoothly, so what you see is exactly what's scored.

export const FLOOR = "#b9b5c6";
const SLAB = 70; // how deep the floor slab looks, in arena units
const BODY_R = 22; // roller drum radius

// The view: arena (x, y, height z) to screen pixels. Height goes up the screen.
export function makeView(cam, W, H) {
  const k = cam.z * Math.SQRT1_2;
  const cu = (cam.x - cam.y) * k, cv = (cam.x + cam.y) * k * 0.5;
  return {
    k,
    p(x, y, z = 0) {
      return [W / 2 + (x - y) * k - cu, H / 2 + (x + y) * k * 0.5 - cv - z * k * 1.1];
    },
    // canvas transform taking the arena plane at height 0 onto the screen
    plane(dpr) {
      return [dpr * k, dpr * k * 0.5, -dpr * k, dpr * k * 0.5, dpr * (W / 2 - cu), dpr * (H / 2 - cv)];
    },
  };
}

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
};

// The slab under the floor: the two faces that point toward the viewer.
export function drawSlab(ctx, v, a, dark) {
  const corners = [[a.x1, a.y0], [a.x1, a.y1], [a.x0, a.y1]].map(([x, y]) => [v.p(x, y), v.p(x, y, -SLAB)]);
  ctx.fillStyle = shade(dark, -0.25);
  face(ctx, corners[0], corners[1]);
  ctx.fillStyle = shade(dark, -0.45);
  face(ctx, corners[1], corners[2]);
}
function face(ctx, [a, a2], [b, b2]) {
  ctx.beginPath();
  ctx.moveTo(...a);
  ctx.lineTo(...b);
  ctx.lineTo(...b2);
  ctx.lineTo(...a2);
  ctx.closePath();
  ctx.fill();
}

// Paint the floor texture: one pixel per cell, team colour fading toward the
// bare floor as the paint ages.
export function paintFloor(img, cells, painted, now, fadeMs, colors) {
  const floor = hexRgb(FLOOR), team = colors.map(hexRgb);
  const d = img.data;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    let r = floor[0], g = floor[1], b = floor[2];
    if (c) {
      const age = (now - painted[i]) / fadeMs;
      // full strength for most of its life, then a quick fade at the end
      const s = age < 0.6 ? 1 : Math.max(0.25, 1 - ((age - 0.6) / 0.4) * 0.75);
      const t = team[c - 1];
      r += (t[0] - r) * s;
      g += (t[1] - g) * s;
      b += (t[2] - b) * s;
    }
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
}
const hexRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Faint tiles over the paint, so speed and distance read on the floor.
export function drawTiles(ctx, a, step, k) {
  if (step * k < 10) return;
  ctx.save();
  ctx.strokeStyle = "rgba(20, 10, 60, 0.08)";
  ctx.lineWidth = 1.5 / k;
  ctx.beginPath();
  for (let x = a.x0; x <= a.x1; x += step) { ctx.moveTo(x, a.y0); ctx.lineTo(x, a.y1); }
  for (let y = a.y0; y <= a.y1; y += step) { ctx.moveTo(a.x0, y); ctx.lineTo(a.x1, y); }
  ctx.stroke();
  ctx.restore();
}

// One roller: a shadow, a drum lying across its heading, and a handle sloping
// back to a grip. `me` gets a ring so you can find yourself.
export function drawRoller(ctx, v, r, color, width, me) {
  const k = v.k;
  const cos = Math.cos(r.h), sin = Math.sin(r.h);
  const half = width / 2;
  const ax = r.x - sin * half, ay = r.y + cos * half;
  const bx = r.x + sin * half, by = r.y - cos * half;

  // shadow
  ctx.fillStyle = "rgba(10, 5, 30, 0.28)";
  ctx.beginPath();
  const [sx, sy] = v.p(r.x, r.y);
  ctx.ellipse(sx, sy, (half + 6) * k, (half + 6) * k * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  if (me) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.ellipse(sx, sy, (half + 16) * k, (half + 16) * k * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // handle: from the drum's axle, back and up to a grip
  const hx = r.x - cos * 58, hy = r.y - sin * 58;
  const axle = v.p(r.x, r.y, BODY_R), grip = v.p(hx, hy, 78);
  const behind = sin > -cos; // the handle is behind the drum when it points away from the viewer
  const handle = () => {
    ctx.strokeStyle = "#1a1530";
    ctx.lineWidth = Math.max(2, 5 * k);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...axle);
    ctx.lineTo(...grip);
    ctx.stroke();
    ctx.lineWidth = Math.max(3, 9 * k);
    const g2 = v.p(hx - sin * 16, hy + cos * 16, 78), g3 = v.p(hx + sin * 16, hy - cos * 16, 78);
    ctx.beginPath();
    ctx.moveTo(...g2);
    ctx.lineTo(...g3);
    ctx.stroke();
  };
  if (behind) handle();

  // drum: a real cylinder lying across the heading. Each end is a circle
  // standing upright (spanned by the heading and straight up), projected; the
  // body is the outline around both ends, and the nearer end is drawn on top.
  const ring = (ex, ey) => {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const t = (i / 20) * Math.PI * 2;
      pts.push(v.p(ex + cos * BODY_R * Math.cos(t), ey + sin * BODY_R * Math.cos(t), BODY_R + BODY_R * Math.sin(t)));
    }
    return pts;
  };
  const ra = ring(ax, ay), rb = ring(bx, by);
  const near = ax + ay > bx + by ? ra : rb;
  poly(ctx, hull([...ra, ...rb]), shade(color, -0.15));
  // a highlight along the top of the drum
  ctx.strokeStyle = shade(color, 0.5);
  ctx.lineWidth = Math.max(1.5, BODY_R * 0.35 * k);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(...v.p(ax, ay, BODY_R * 1.8));
  ctx.lineTo(...v.p(bx, by, BODY_R * 1.8));
  ctx.stroke();
  poly(ctx, near, shade(color, -0.45));
  const hub = near === ra ? v.p(ax, ay, BODY_R) : v.p(bx, by, BODY_R);
  ctx.fillStyle = "#1a1530";
  ctx.beginPath();
  ctx.arc(hub[0], hub[1], Math.max(1.5, BODY_R * 0.22 * k), 0, Math.PI * 2);
  ctx.fill();

  if (!behind) handle();
}

function poly(ctx, pts, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
  ctx.closePath();
  ctx.fill();
}

// Convex hull (monotone chain) of screen points.
function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function drawTag(ctx, v, r, label, color, me) {
  const [x, y] = v.p(r.x, r.y, 115);
  ctx.font = `800 ${me ? 13 : 12}px ui-rounded, system-ui, sans-serif`;
  const w = ctx.measureText(label).width + 12;
  ctx.fillStyle = "rgba(14, 10, 28, 0.82)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 18, w, 19, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - 4);
  ctx.textAlign = "start";
}
