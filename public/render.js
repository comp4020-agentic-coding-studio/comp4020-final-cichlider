// How paint looks. A roller stroke is a fixed-width, round-ended band, the
// same shape the server's grid scores, so what you see is what you own.
// Strokes are drawn oldest first: the last roller over a spot is the colour on
// top, which is also the team that owns it.

export const FLOOR = "#e9e6f2";
export const VOID = "#1b1530";

function path(ctx, p) {
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

export function drawStroke(ctx, s, color, width) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = width;
  path(ctx, s.points);
  ctx.stroke();
  ctx.restore();
}

// The arena floor: a pale court with faint tiles, ringed by the dark outside.
export function drawFloor(ctx, a, cell, z) {
  ctx.fillStyle = FLOOR;
  ctx.fillRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  const tile = cell * 5;
  if (tile * z < 8) return;
  ctx.save();
  ctx.strokeStyle = "rgba(60, 50, 110, 0.08)";
  ctx.lineWidth = 1.5 / z;
  ctx.beginPath();
  for (let x = a.x0; x <= a.x1; x += tile) { ctx.moveTo(x, a.y0); ctx.lineTo(x, a.y1); }
  for (let y = a.y0; y <= a.y1; y += tile) { ctx.moveTo(a.x0, y); ctx.lineTo(a.x1, y); }
  ctx.stroke();
  ctx.restore();
}

export function drawRim(ctx, a, z) {
  ctx.save();
  ctx.strokeStyle = "#0e0a1c";
  ctx.lineWidth = 10 / z;
  ctx.strokeRect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  ctx.restore();
}
