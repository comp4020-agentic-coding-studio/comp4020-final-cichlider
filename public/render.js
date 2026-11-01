// How the wall and the rollers look. The wall is upright and seen almost face
// on: only a slight tilt, so the rollers standing out from it, and the wall's
// own thickness along the bottom, read as 2.5D. Paint is a small texture built
// from the server's grid, so drawing cost stays bounded as the wall fills up.

export const WALL = "#dcd9e2";
const TILT_Y = 0.94; // how much the wall's height is foreshortened
const TILT_Z = 0.34; // how far something sticking out of the wall shifts up the screen
const THICK = 46; // the wall's thickness, seen along its bottom edge
const BODY_R = 22; // roller drum radius

// The view: wall (x, y, and z out of the wall) to screen pixels.
export function makeView(cam, W, H) {
  const k = cam.z;
  const ox = W / 2 - cam.x * k, oy = H / 2 - cam.y * k * TILT_Y;
  return {
    k,
    p: (x, y, z = 0) => [ox + x * k, oy + y * k * TILT_Y - z * k * TILT_Z],
    // canvas transform taking the wall's face (z = 0) onto the screen
    plane: (dpr) => [dpr * k, 0, 0, dpr * k * TILT_Y, dpr * ox, dpr * oy],
    // which of two points is nearer the viewer (bigger is nearer)
    depth: (x, y, z = 0) => y * TILT_Z + z * TILT_Y,
    // the wall rectangle visible on screen, for culling
    visible(a) {
      return { x0: (0 - ox) / k, x1: (W - ox) / k, y0: (0 - oy) / (k * TILT_Y), y1: (H - oy) / (k * TILT_Y) };
    },
  };
}

export const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
};

// ---------------------------------------------------------------- the wall

// The face: pale concrete panels with a faint seam every 100 units, a little
// lighter toward the top. Drawn in wall coordinates (under plane()).
export function drawWall(ctx, a, k) {
  const g = ctx.createLinearGradient(0, a.y0, 0, a.y1);
  g.addColorStop(0, shade(WALL, 0.25));
  g.addColorStop(1, shade(WALL, -0.06));
  ctx.fillStyle = g;
  ctx.fillRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  ctx.save();
  ctx.strokeStyle = "rgba(40, 30, 80, 0.10)";
  ctx.lineWidth = 1.2 / k;
  ctx.beginPath();
  for (let x = a.x0 + 100; x < a.x1; x += 100) { ctx.moveTo(x, a.y0); ctx.lineTo(x, a.y1); }
  for (let y = a.y0 + 100; y < a.y1; y += 100) { ctx.moveTo(a.x0, y); ctx.lineTo(a.x1, y); }
  ctx.stroke();
  // little form-tie holes where the seams cross, like poured concrete
  ctx.fillStyle = "rgba(40, 30, 80, 0.10)";
  for (let x = a.x0 + 50; x < a.x1; x += 100) for (let y = a.y0 + 50; y < a.y1; y += 100) {
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// The wall's thickness along its bottom edge, and a frame around the face.
// Drawn in screen coordinates.
export function drawEdge(ctx, v, a, dark) {
  const [lx, ly] = v.p(a.x0, a.y1), [rx] = v.p(a.x1, a.y1);
  const drop = THICK * v.k * TILT_Z;
  const g = ctx.createLinearGradient(0, ly, 0, ly + drop);
  g.addColorStop(0, shade(WALL, -0.35));
  g.addColorStop(1, shade(WALL, -0.6));
  ctx.fillStyle = g;
  ctx.fillRect(lx, ly, rx - lx, drop);
  const [tx, ty] = v.p(a.x0, a.y0);
  ctx.strokeStyle = dark;
  ctx.lineWidth = Math.max(3, 8 * v.k);
  ctx.strokeRect(tx, ty, rx - tx, ly - ty);
}

// ---------------------------------------------------------------- paint

// Interpolate the authoritative cell grid onto a small texture. Coverage
// tapers between cell centres, like the old marching-squares outline, but no
// Path2D objects are built as the wall fills. A pixel keeps the stronger team
// colour at a contested edge, avoiding muddy mixed-colour seams.
export function paintTexture(cells, painted, now, g, colors, out, shadow, scale) {
  const { cols, rows } = g;
  const alpha0 = new Float32Array(cells.length), alpha1 = new Float32Array(cells.length);
  const fresh0 = new Uint8Array(cells.length), fresh1 = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    const owner = cells[i];
    if (!owner) continue;
    const age = now - painted[i];
    const fresh = age < g.fadeMs * 0.6;
    const opacity = fresh ? 1 : age < g.fadeMs * 0.8 ? 0.7 : 0.4;
    if (owner === 1) { alpha0[i] = opacity; fresh0[i] = +fresh; }
    else { alpha1[i] = opacity; fresh1[i] = +fresh; }
  }
  const rgb = colors.map((h) => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const width = cols * scale, height = rows * scale;
  for (let y = 0; y < height; y++) {
    const gy = (y + 0.5) / scale - 0.5;
    const row = Math.floor(gy), fy = gy - row;
    const row0 = row >= 0 ? row * cols : -1;
    const row1 = row + 1 < rows ? (row + 1) * cols : -1;
    for (let x = 0; x < width; x++) {
      const gx = (x + 0.5) / scale - 0.5;
      const col = Math.floor(gx), fx = gx - col;
      const c0 = col >= 0 ? col : -1, c1 = col + 1 < cols ? col + 1 : -1;
      const i00 = row0 >= 0 && c0 >= 0 ? row0 + c0 : -1;
      const i10 = row0 >= 0 && c1 >= 0 ? row0 + c1 : -1;
      const i01 = row1 >= 0 && c0 >= 0 ? row1 + c0 : -1;
      const i11 = row1 >= 0 && c1 >= 0 ? row1 + c1 : -1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;
      const sample = (a) =>
        (i00 < 0 ? 0 : a[i00] * w00) + (i10 < 0 ? 0 : a[i10] * w10) +
        (i01 < 0 ? 0 : a[i01] * w01) + (i11 < 0 ? 0 : a[i11] * w11);
      const a0 = sample(alpha0), a1 = sample(alpha1);
      const p = (y * width + x) * 4;
      if (a0 + a1 > 0) {
        const c = rgb[a0 >= a1 ? 0 : 1];
        out[p] = c[0]; out[p + 1] = c[1]; out[p + 2] = c[2];
        out[p + 3] = Math.round((a0 + a1) * 255);
      } else out[p] = out[p + 1] = out[p + 2] = out[p + 3] = 0;
      const f0 = sample(fresh0), f1 = sample(fresh1);
      if (f0 + f1 > 0) {
        const c = rgb[f0 >= f1 ? 0 : 1];
        shadow[p] = Math.round(c[0] * 0.6);
        shadow[p + 1] = Math.round(c[1] * 0.6);
        shadow[p + 2] = Math.round(c[2] * 0.6);
        shadow[p + 3] = Math.round((f0 + f1) * 140);
      } else shadow[p] = shadow[p + 1] = shadow[p + 2] = shadow[p + 3] = 0;
    }
  }
}

// The bead of paint at the bottom of a running drip.
export function drawDrip(ctx, v, d, color) {
  const [x, y] = v.p(d[0], d[1], 3);
  const r = Math.max(2.5, 7.5 * v.k);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.85, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.35, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- rollers

// One roller: a soft shadow on the wall, a drum lying across its heading (a
// real cylinder: two upright end circles joined by their outline), and a handle
// rising out of the wall to a grip. `me` gets a dashed ring.
export function drawRoller(ctx, v, r, color, width, me) {
  const k = v.k;
  const cos = Math.cos(r.h), sin = Math.sin(r.h);
  const half = width / 2;
  const ax = r.x - sin * half, ay = r.y + cos * half;
  const bx = r.x + sin * half, by = r.y - cos * half;
  const [sx, sy] = v.p(r.x, r.y);
  const axis = Math.atan2((by - ay) * TILT_Y, bx - ax);

  ctx.fillStyle = "rgba(20, 10, 50, 0.22)";
  ctx.beginPath();
  ctx.ellipse(sx, sy + 3 * k, (half + 8) * k, (BODY_R + 6) * k * TILT_Y, axis, 0, Math.PI * 2);
  ctx.fill();

  if (me) {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.ellipse(sx, sy, (half + 20) * k, (half + 20) * k * TILT_Y, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const ring = (ex, ey) => {
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      pts.push(v.p(ex + cos * BODY_R * Math.cos(t), ey + sin * BODY_R * Math.cos(t), BODY_R + BODY_R * Math.sin(t)));
    }
    return pts;
  };
  const ra = ring(ax, ay), rb = ring(bx, by);
  const aNear = v.depth(ax, ay) > v.depth(bx, by);
  poly(ctx, hull([...ra, ...rb]), shade(color, -0.12));
  // a soft highlight along the top of the drum, and a seam of nap
  ctx.lineCap = "round";
  ctx.strokeStyle = shade(color, 0.5);
  ctx.lineWidth = Math.max(1.5, BODY_R * 0.4 * k);
  ctx.beginPath();
  ctx.moveTo(...v.p(ax, ay, BODY_R * 1.75));
  ctx.lineTo(...v.p(bx, by, BODY_R * 1.75));
  ctx.stroke();
  ctx.strokeStyle = shade(color, -0.35);
  ctx.lineWidth = Math.max(1, BODY_R * 0.12 * k);
  ctx.beginPath();
  ctx.moveTo(...v.p(ax - cos * BODY_R * 0.7, ay - sin * BODY_R * 0.7, BODY_R * 0.3));
  ctx.lineTo(...v.p(bx - cos * BODY_R * 0.7, by - sin * BODY_R * 0.7, BODY_R * 0.3));
  ctx.stroke();
  const near = aNear ? ra : rb;
  poly(ctx, near, shade(color, -0.4));
  const [hx0, hy0] = aNear ? v.p(ax, ay, BODY_R) : v.p(bx, by, BODY_R);
  ctx.fillStyle = "#1a1530";
  ctx.beginPath();
  ctx.arc(hx0, hy0, Math.max(1.5, BODY_R * 0.25 * k), 0, Math.PI * 2);
  ctx.fill();

  // the handle stands out of the wall, toward the viewer, so it goes on top
  const hx = r.x - cos * 52, hy = r.y - sin * 52;
  const axle = v.p(r.x, r.y, BODY_R), elbow = v.p(r.x - cos * 26, r.y - sin * 26, 70), grip = v.p(hx, hy, 92);
  ctx.strokeStyle = "#1a1530";
  ctx.lineWidth = Math.max(2, 5 * k);
  ctx.beginPath();
  ctx.moveTo(...axle);
  ctx.lineTo(...elbow);
  ctx.lineTo(...grip);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(3.5, 11 * k);
  const g2 = v.p(hx - sin * 14, hy + cos * 14, 92), g3 = v.p(hx + sin * 14, hy - cos * 14, 92);
  ctx.beginPath();
  ctx.moveTo(...g2);
  ctx.lineTo(...g3);
  ctx.stroke();
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

// A name chip floating above a roller.
export function drawTag(ctx, v, r, label, fill, ink) {
  const [x, y0] = v.p(r.x, r.y, 92);
  const y = y0 - 14;
  ctx.font = "700 12px ui-rounded, system-ui, -apple-system, 'PingFang SC', sans-serif";
  const w = ctx.measureText(label).width + 14;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 11, w, 20, 10);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}
