import { PALETTES } from "./palettes.js";
import { WALL, drawDrip, drawEdge, drawPaint, drawRoller, drawTag, drawWall, makeView, paintPaths, shade } from "./render.js";

const $ = (s) => document.querySelector(s);
const canvas = $("#wall");
const ctx = canvas.getContext("2d");
const mini = $("#mini");
const mctx = mini.getContext("2d");
const miniSrc = document.createElement("canvas"); // one pixel per cell, for the minimap
const msctx = miniSrc.getContext("2d");

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: fine */ } },
};

// ---------------------------------------------------------------- state

let W = 0, H = 0, dpr = 1;
const cam = { x: 0, y: 0, z: 0.6 }; // wall point at screen centre, and zoom
let zoomFactor = store.get("turf.zoom", 1);
let me = null;
let game = null; // the fixed facts from /api/state: arena, cell size, roller width, fade time
let cells = null; // owner per cell: 0 bare, 1 team 0, 2 team 1
let painted = null; // game-clock ms each cell was last painted
let gameNow = 0;
let score = [0, 0];
let paths = null; // paint shapes, rebuilt when the paint changes
let pathsAt = -Infinity;
let pathsDirty = true;
let drips = [];
const rollers = new Map(); // id -> { team, npc, name, move, x, y, h (shown), tx, ty, th (latest from server) }
let palette = PALETTES.find((p) => p.id === store.get("turf.palette", "default")) ?? PALETTES[0];

const colorOf = (team) => palette.teams[team].color;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- drawing

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
}

// Close enough to see your roller and the paint around it.
const baseZoom = () => Math.max(0.45, Math.min(1.1, Math.max(W, H) / 1300));

function render(dt) {
  const dark = colorOf(1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = shade(dark, -0.72);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!game) return;

  // ease every roller toward where the server last put it
  const ease = Math.min(1, dt * 12);
  for (const r of rollers.values()) {
    r.x += (r.tx - r.x) * ease;
    r.y += (r.ty - r.y) * ease;
    r.h = wrap(r.h + wrap(r.th - r.h) * ease);
  }

  // the camera follows you
  const mine = me && rollers.get(me.id);
  if (mine) {
    cam.x += (mine.x - cam.x) * Math.min(1, dt * 5);
    cam.y += (mine.y - cam.y) * Math.min(1, dt * 5);
  }
  cam.z = baseZoom() * zoomFactor;
  const v = makeView(cam, W, H);
  const a = game.arena;

  // the wall and its paint, in wall coordinates
  ctx.setTransform(...v.plane(dpr));
  drawWall(ctx, a, v.k);
  if ((pathsDirty && gameNow - pathsAt > 120) || gameNow - pathsAt > 500) {
    paths = paintPaths(cells, painted, gameNow, game);
    pathsAt = gameNow;
    pathsDirty = false;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(a.x0, a.y0, a.x1 - a.x0, a.y1 - a.y0);
  ctx.clip();
  drawPaint(ctx, paths, palette.teams.map((t) => t.color));
  ctx.restore();

  // everything standing out from the wall, in screen pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawEdge(ctx, v, a, shade(dark, -0.45));
  for (const d of drips) drawDrip(ctx, v, d, colorOf(d[2]));
  const list = [...rollers.entries()].sort(([, p], [, q]) => p.y - q.y);
  for (const [id, r] of list) drawRoller(ctx, v, r, colorOf(r.team), game.roller, me && id === me.id);
  for (const [id, r] of list) {
    const isMe = me && id === me.id;
    const label = isMe ? `${r.name} · you` : r.npc ? `bot · ${r.name.replace(/^bot-/, "")}` : r.name;
    drawTag(ctx, v, r, label, isMe ? "#ffffff" : shade(colorOf(1), -0.55), isMe ? "#111" : shade(colorOf(r.team), r.team === 1 ? 0.55 : 0));
  }
}

let last = performance.now(), lastMini = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  render(dt);
  if (t - lastMini > 200) { minimap(); lastMini = t; }
  requestAnimationFrame(frame);
}

// The whole wall in the corner: paint, every roller, and the part you're seeing.
function minimap() {
  if (!game) return;
  const img = msctx.createImageData(game.cols, game.rows);
  const wall = hex(WALL), team = [hex(colorOf(0)), hex(colorOf(1))];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i] ? team[cells[i] - 1] : wall;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  msctx.putImageData(img, 0, 0);
  const mw = mini.width, mh = mini.height;
  mctx.imageSmoothingEnabled = false;
  mctx.drawImage(miniSrc, 0, 0, mw, mh);
  const a = game.arena;
  const sx = mw / (a.x1 - a.x0), sy = mh / (a.y1 - a.y0);
  for (const [id, r] of rollers) {
    const isMe = me && id === me.id;
    mctx.fillStyle = isMe ? "#ffffff" : colorOf(r.team);
    mctx.strokeStyle = isMe ? "#000" : shade(colorOf(1), -0.6);
    mctx.lineWidth = 2;
    mctx.beginPath();
    mctx.arc((r.x - a.x0) * sx, (r.y - a.y0) * sy, isMe ? 6 : 4.5, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
  }
  const view = makeView(cam, W, H).visible(a);
  mctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  mctx.lineWidth = 2;
  mctx.strokeRect((view.x0 - a.x0) * sx, (view.y0 - a.y0) * sy, (view.x1 - view.x0) * sx, (view.y1 - view.y0) * sy);
}
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// ---------------------------------------------------------------- the HUD

let hudKey = "";
function hud() {
  if (!game) return;
  const pct = score.map((n) => (100 * n) / game.total);
  let humans = 0, bots = 0;
  for (const r of rollers.values()) r.npc ? bots++ : humans++;
  const key = `${pct.map((p) => p.toFixed(1))}|${humans}|${bots}|${palette.id}|${me?.team}`;
  if (key === hudKey) return;
  hudKey = key;
  for (const t of [0, 1]) {
    $(`#pct${t}`).textContent = `${pct[t].toFixed(1)}%`;
    $(`#bar${t}`).style.width = `${pct[t]}%`;
    $(`#name${t}`).textContent = palette.teams[t].name;
    $(`#side${t}`).classList.toggle("mine", me?.team === t);
  }
  const lead = pct[0] === pct[1] ? "level" : `${palette.teams[pct[0] > pct[1] ? 0 : 1].name} leads by ${Math.abs(pct[0] - pct[1]).toFixed(1)}`;
  $("#lead").textContent = lead;
  $("#online").textContent = `${humans} ${humans === 1 ? "player" : "players"}${bots ? ` + ${bots} bots` : ""}`;
}

function applyPalette() {
  const root = document.documentElement.style;
  root.setProperty("--light", colorOf(0));
  root.setProperty("--dark", colorOf(1));
  root.setProperty("--deep", shade(colorOf(1), -0.55));
  root.setProperty("--void", shade(colorOf(1), -0.72));
  root.setProperty("--wall", WALL);
  if (me) {
    root.setProperty("--mine", colorOf(me.team));
    $("#teamTag").textContent = palette.teams[me.team].name;
    $("#teamDot").className = `dot t${me.team}`;
    const b = document.createElement("b");
    b.className = `t${me.team}`;
    b.textContent = `Team ${palette.teams[me.team].name}`;
    $("#welcomeTeam").replaceChildren("You're on ", b, ".");
  }
  for (const sw of document.querySelectorAll(".pal")) sw.setAttribute("aria-pressed", String(sw.dataset.id === palette.id));
  document.querySelector('meta[name="theme-color"]').content = shade(colorOf(1), -0.72);
  hudKey = "";
  hud();
}

for (const p of PALETTES) {
  const b = document.createElement("button");
  b.className = "pal";
  b.dataset.id = p.id;
  b.title = `${p.teams[0].name} / ${p.teams[1].name}`;
  b.setAttribute("aria-label", `${p.teams[0].name} and ${p.teams[1].name}`);
  b.style.setProperty("--a", p.teams[0].color);
  b.style.setProperty("--b", p.teams[1].color);
  b.onclick = () => {
    palette = p;
    store.set("turf.palette", p.id);
    applyPalette();
  };
  $("#palettes").append(b);
}

// ---------------------------------------------------------------- talking to the server

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", ...(me ? { authorization: `Bearer ${me.secret}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status });
  return data;
}

function applyRollers(list, snap) {
  const seen = new Set();
  for (const [id, team, x, y, h, move, npc, name] of list) {
    seen.add(id);
    const r = rollers.get(id);
    if (!r || snap) rollers.set(id, { team, npc: npc === 1, name, move, x, y, h, tx: x, ty: y, th: h });
    else Object.assign(r, { team, npc: npc === 1, name, move, tx: x, ty: y, th: h });
  }
  for (const id of rollers.keys()) if (!seen.has(id)) rollers.delete(id);
}

const unbase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function loadState() {
  const s = await api("GET", "/api/state");
  game = s;
  cells = unbase64(s.owners);
  const ages = new Uint16Array(unbase64(s.ages).buffer);
  painted = new Float64Array(cells.length);
  for (let i = 0; i < cells.length; i++) painted[i] = s.t - ages[i] * 100;
  miniSrc.width = s.cols;
  miniSrc.height = s.rows;
  gameNow = s.t;
  score = s.s;
  drips = s.drips;
  applyRollers(s.rollers, true);
  const mine = me && rollers.get(me.id);
  if (mine) { cam.x = mine.x; cam.y = mine.y; }
  pathsDirty = true;
  hud();
}

function connect() {
  let first = true;
  const es = new EventSource("/api/events");
  es.onopen = () => {
    if (!first) loadState().catch(() => {}); // catch up on whatever we missed
    first = false;
  };
  es.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type !== "tick" || !game) return;
    gameNow = m.t;
    for (let i = 0; i < m.c.length; i += 2) {
      cells[m.c[i]] = m.c[i + 1];
      painted[m.c[i]] = m.t;
    }
    if (m.c.length) pathsDirty = true;
    score = m.s;
    drips = m.d ?? [];
    applyRollers(m.r, false);
    hud();
  };
}

// ---------------------------------------------------------------- the five actions

// Whatever's held right now, from keys and on-screen buttons together.
const held = { fwd: new Set(), back: new Set(), left: new Set(), right: new Set() };
let sent = { move: null, turn: null };
let lastSentAt = 0;

function currentInput() {
  return {
    move: (held.fwd.size ? 1 : 0) - (held.back.size ? 1 : 0),
    turn: (held.right.size ? 1 : 0) - (held.left.size ? 1 : 0),
  };
}

function sync(force = false) {
  if (!me) return;
  const now = currentInput();
  for (const el of document.querySelectorAll("[data-act]")) el.classList.toggle("on", held[el.dataset.act].size > 0);
  if (!force && now.move === sent.move && now.turn === sent.turn) return;
  sent = now;
  lastSentAt = Date.now();
  api("POST", "/api/input", now).catch((e) => {
    if (e.status !== 429) toast(`lost touch with the wall: ${e.message}`);
  });
}

// Staying on the wall while standing still: tell the server we're here.
setInterval(() => {
  if (me && !document.hidden && Date.now() - lastSentAt > 4000) sync(true);
}, 1000);

const KEYS = {
  KeyW: "fwd", ArrowUp: "fwd",
  KeyS: "back", ArrowDown: "back",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
};
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "+" || e.key === "=") return setZoom(zoomFactor * 1.2);
  if (e.key === "-") return setZoom(zoomFactor / 1.2);
  const act = KEYS[e.code];
  if (!act) return;
  e.preventDefault();
  held[act].add(e.code);
  sync();
});
window.addEventListener("keyup", (e) => {
  const act = KEYS[e.code];
  if (!act) return;
  held[act].delete(e.code);
  sync();
});
// let go of everything when the tab loses focus, so nobody rolls off forever
window.addEventListener("blur", () => {
  for (const s of Object.values(held)) s.clear();
  sync();
});

for (const b of document.querySelectorAll("#pad button")) {
  const act = b.dataset.act;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    held[act].add(`p${e.pointerId}`);
    sync();
  });
  const up = (e) => { held[act].delete(`p${e.pointerId}`); sync(); };
  b.addEventListener("pointerup", up);
  b.addEventListener("pointercancel", up);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
}

function setZoom(f) {
  zoomFactor = Math.max(0.5, Math.min(2.2, f));
  store.set("turf.zoom", zoomFactor);
}
$("#zoomIn").onclick = () => setZoom(zoomFactor * 1.2);
$("#zoomOut").onclick = () => setZoom(zoomFactor / 1.2);
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  setZoom(zoomFactor * Math.exp(-e.deltaY * 0.002));
}, { passive: false });

$("#name").addEventListener("change", async (e) => {
  try {
    const r = await api("PATCH", "/api/me", { name: e.target.value });
    me.name = r.name;
    toast(`you're now “${r.name}”`);
  } catch (err) {
    e.target.value = me.name;
    toast(err.message);
  }
});

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- start

async function start() {
  resize();
  window.addEventListener("resize", resize);
  applyPalette();
  requestAnimationFrame(frame);
  connect();
  try {
    me = await api("POST", "/api/session", { secret: store.get("wall.secret", null) });
    store.set("wall.secret", me.secret);
    $("#name").value = me.name;
    applyPalette();
    sync(true); // standing still is an action too: it puts you on the wall
  } catch (e) {
    toast(`couldn't get you a team: ${e.message}`);
  }
  try {
    await loadState();
  } catch (e) {
    toast(`couldn't load the wall: ${e.message}`);
  }
  if (!store.get("turf.welcomed3", false)) {
    $("#welcome").hidden = false;
    $("#start").onclick = () => { $("#welcome").hidden = true; store.set("turf.welcomed3", true); };
  }
}

start();
